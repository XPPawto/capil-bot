import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { checkRateLimit } from "./rateLimit";
import { logInboxMessage, logOutboundFromDevice, type GroupMeta } from "./messageLog";
import { logInboxMediaIfPresent } from "../media/inboxMedia";
import { extractInboxText, extractParticipantNumber, extractWaNumber } from "./messageHandler";
import { getGroupName } from "../wa/groupNameCache";
import { wasSentByDashboard } from "../wa/sentMessageTracker";

interface MessagesUpsertPayload {
  messages: WAMessage[];
  type: string;
}

/**
 * Akun EKSTRA (bisa lebih dari satu - Akun Kedua, Akun Ketiga, dst, dibedakan lewat
 * `accountId` = ExtraAccount.id) BUKAN bot layanan - tidak ada menu, tidak ada alur
 * pengajuan, tidak ada balasan otomatis apa pun. Tugas handler ini adalah mencatat semua
 * pesan (teks + media, termasuk grup WA yang diikuti akun ini) ke Pesan Masuk
 * (/admin-xpawto, channel EXTRA) - baik yang masuk dari warga MAUPUN yang dibalas keluar,
 * dari mana pun asalnya (lewat dashboard, atau diketik LANGSUNG dari HP akun ini) - supaya
 * dashboard selalu jadi cerminan utuh percakapan aslinya, bukan cuma separuh yang lewat web.
 *
 * WhatsApp multi-device mengirim SEMUA event pesan (termasuk yang fromMe:true, dikirim
 * dari perangkat lain yang sama-sama tertaut ke akun ini - misalnya HP utamanya sendiri)
 * ke kita sebagai salah satu perangkat tertaut. Dua kemungkinan untuk event fromMe:
 *  1. Echo dari balasan yang KITA SENDIRI baru saja kirim (lewat dashboard, ATAU alur bot
 *     kalau ada) - ID pesannya sudah ditandai lebih dulu oleh wa/humanSend.ts (lihat
 *     sentMessageTracker) -> dilewati di sini supaya tidak dobel.
 *  2. Balasan yang diketik langsung dari HP akun ini (bukan lewat dashboard) - ID-nya
 *     tidak pernah kita catat duluan -> justru ini yang direkam sebagai pesan baru,
 *     supaya kelihatan juga di /admin-xpawto.
 */
export async function handleExtraAccountIncomingMessages(
  sock: WASocket,
  payload: MessagesUpsertPayload,
  accountId: number
): Promise<void> {
  if (payload.type !== "notify") return;

  for (const msg of payload.messages) {
    const jid = msg.key.remoteJid;
    if (!jid) continue;
    if (jid === "status@broadcast" || jid.endsWith("@broadcast")) continue;
    if (!msg.message) continue;

    const isFromMe = Boolean(msg.key.fromMe);
    if (isFromMe) {
      if (wasSentByDashboard(msg.key.id)) continue;
    } else {
      // Rate limit cuma relevan untuk pesan MASUK (potensi flooding dari luar) - balasan
      // yang kita kirim sendiri dari HP tidak boleh ikut ditahan oleh limiter ini.
      // Dipisah per akun (jid saja tidak cukup unik lintas akun, tapi rate limiter ini
      // murni anti-flood per lawan bicara - cukup aman dibagi bersama).
      const rateLimitResult = checkRateLimit(jid);
      if (rateLimitResult === "blocked") continue;
    }

    const isGroup = jid.endsWith("@g.us");
    const text = extractInboxText(msg);

    let waNumber: string;
    let group: GroupMeta | undefined;
    if (isGroup) {
      // Untuk grup, "nomor" percakapan itu sendiri tidak relevan (grup, bukan satu
      // orang) - waNumber diisi nomor pengirim pesan ini sekadar supaya kolom tidak
      // kosong; identitas percakapan yang sebenarnya dipegang oleh waJid (JID grup) +
      // isGroup/groupName di sisi tampilan. Pesan fromMe di grup tidak butuh
      // senderNumber/senderName (pengirimnya sudah pasti "kita", ditandai via direction).
      const senderNumber = isFromMe ? undefined : extractParticipantNumber(msg);
      waNumber = senderNumber ?? jid.split("@")[0];
      group = {
        isGroup: true,
        groupName: await getGroupName(sock, jid),
        senderNumber,
        senderName: isFromMe ? undefined : (msg.pushName ?? undefined),
      };
    } else {
      waNumber = isFromMe ? jid.split("@")[0] : extractWaNumber(msg, jid);
      // Bukan grup - senderName di sini berarti nama profil WA lawan bicara itu sendiri
      // (bukan grup), dipakai supaya daftar Pesan Masuk bisa tampilkan nama, bukan cuma
      // nomor. Cuma diisi dari pesan MASUK (fromMe = kita, nama kita sendiri tidak relevan).
      if (!isFromMe && msg.pushName) {
        group = { isGroup: false, senderName: msg.pushName };
      }
    }

    const direction: "INBOUND" | "OUTBOUND" = isFromMe ? "OUTBOUND" : "INBOUND";

    try {
      if (text) {
        if (isFromMe) {
          await logOutboundFromDevice(jid, waNumber, text, "EXTRA", group, accountId);
        } else {
          await logInboxMessage(jid, waNumber, text, "EXTRA", group, accountId);
        }
      }
      await logInboxMediaIfPresent(sock, msg, jid, waNumber, "EXTRA", group, direction, accountId);
    } catch (err) {
      logger.error({ err, jid, accountId }, "Gagal mencatat pesan akun ekstra ke kotak masuk");
    }
  }
}
