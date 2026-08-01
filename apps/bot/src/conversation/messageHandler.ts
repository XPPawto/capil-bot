import { extractMessageContent, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { handleConversationMessage } from "./handler";
import { runExclusive } from "./mutex";

interface MessagesUpsertPayload {
  messages: WAMessage[];
  type: string;
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

    const waNumber = jid.split("@")[0];
    const text = extractText(msg);

    try {
      // runExclusive: pesan lain dari JID yang sama (mis. beberapa foto dikirim
      // sekaligus dari galeri) akan mengantre, tidak diproses paralel, supaya
      // tidak saling menimpa saat baca-ubah-simpan ConversationState.
      await runExclusive(jid, () => handleConversationMessage(sock, jid, waNumber, text, msg));
    } catch (err) {
      logger.error({ err, jid }, "Gagal menangani pesan warga");
    }
  }
}
