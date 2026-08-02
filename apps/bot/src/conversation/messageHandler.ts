import { extractMessageContent, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { handleConversationMessage } from "./handler";
import { runExclusive } from "./mutex";
import { checkRateLimit } from "./rateLimit";
import { humanSendMessage } from "../wa/humanSend";
import { isHumanTakeoverActive } from "./humanTakeover";
import { logInboundIfActiveRequest } from "./messageLog";

interface MessagesUpsertPayload {
  messages: WAMessage[];
  type: string;
}

/**
 * WhatsApp kadang mengalamatkan kontak lewat "LID" (linked ID) yang tidak berkorelasi
 * dengan nomor HP-nya sama sekali (mis. remoteJid "82802724872358@lid") - fitur privasi
 * WhatsApp yang menyembunyikan nomor asli di balik ID internal. Kalau itu terjadi, Baileys
 * tetap menyertakan nomor asli di msg.key.senderPn ("62xxxxxxxxxx@s.whatsapp.net"). Ambil
 * dari situ dulu supaya yang tersimpan/ditampilkan ke petugas nomor HP sungguhan, bukan ID
 * internal. waJid untuk membalas pesan tetap pakai remoteJid asli (jangan diubah) - WhatsApp
 * mengharuskan alamat balasan sama persis dengan yang dipakai kontak untuk mengirim.
 */
function extractWaNumber(msg: WAMessage, jid: string): string {
  const senderPn = msg.key.senderPn;
  if (senderPn) {
    return senderPn.split("@")[0];
  }
  return jid.split("@")[0];
}

function extractText(msg: WAMessage): string | undefined {
  const raw = msg.message;
  if (!raw) return undefined;
  // Buka bungkus documentWithCaptionMessage/viewOnceMessage dkk dulu, sama seperti
  // di media/download.ts, supaya caption pada dokumen terbungkus tetap terbaca.
  const m = extractMessageContent(raw) ?? raw;
  return m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.documentMessage?.caption ?? undefined;
}

export async function handleIncomingMessages(sock: WASocket, payload: MessagesUpsertPayload): Promise<void> {
  if (payload.type !== "notify") return;

  for (const msg of payload.messages) {
    if (msg.key.fromMe) continue;
    const jid = msg.key.remoteJid;
    if (!jid) continue;
    if (jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@broadcast")) continue;
    if (!msg.message) continue;

    const rateLimitResult = checkRateLimit(jid);
    if (rateLimitResult === "blocked") continue; // sedang didiamkan, tidak diproses sama sekali
    if (rateLimitResult === "just_blocked") {
      humanSendMessage(sock, jid, {
        text: "Anda mengirim pesan terlalu cepat. Mohon tunggu beberapa menit sebelum mencoba lagi.",
      }).catch((err) => logger.warn({ err, jid }, "Gagal kirim peringatan rate limit"));
      continue;
    }

    const waNumber = extractWaNumber(msg, jid);
    const text = extractText(msg);

    try {
      // Petugas sedang ambil alih percakapan ini secara manual lewat dashboard - bot
      // harus diam TOTAL (tidak ikut membalas menu/status/dsb), supaya tidak bentrok
      // dengan apa yang sedang diketik petugas. Pesan warga tetap dicatat ke thread chat.
      if (await isHumanTakeoverActive(jid)) {
        if (text) {
          await logInboundIfActiveRequest(jid, text).catch((err) =>
            logger.error({ err, jid }, "Gagal mencatat pesan warga saat mode ambil-alih petugas")
          );
        }
        continue;
      }

      // runExclusive: pesan lain dari JID yang sama (mis. beberapa foto dikirim
      // sekaligus dari galeri) akan mengantre, tidak diproses paralel, supaya
      // tidak saling menimpa saat baca-ubah-simpan ConversationState.
      await runExclusive(jid, () => handleConversationMessage(sock, jid, waNumber, text, msg));
    } catch (err) {
      logger.error({ err, jid }, "Gagal menangani pesan warga");
    }
  }
}
