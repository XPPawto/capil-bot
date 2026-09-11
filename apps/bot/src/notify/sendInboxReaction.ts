import type { InboxChannel } from "@kelurahan/db";
import type { WAMessageKey } from "@whiskeysockets/baileys";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { getExtraAccountSocket } from "../wa/extraAccountManager";

/**
 * Reaksi emoji dikirim ke WhatsApp asli lewat sock.sendMessage(jid, { react }) - BUKAN
 * lewat humanSendMessage (itu buat pesan biasa, ada jeda "mengetik..." yang tidak masuk
 * akal buat reaksi instan). Echo baliknya (fromMe:true, reactionMessage) otomatis kepakai
 * oleh handleReactionIfPresent di messageHandler.ts/extraAccountMessageHandler.ts - jalur
 * itu sudah menandai reaksi fromMe sebagai reactorJid "self" TANPA butuh pengecekan
 * sentMessageTracker sama sekali (beda dari pesan teks), jadi tidak perlu tracking apa pun
 * di sini - baris MessageReaction akan muncul sendiri lewat polling begitu echo-nya sampai.
 */
export async function sendInboxReaction(
  waJid: string,
  targetKey: WAMessageKey,
  emoji: string,
  channel: InboxChannel = "SERVICE",
  extraAccountId?: number
): Promise<void> {
  const sock = channel === "EXTRA" && extraAccountId ? getExtraAccountSocket(extraAccountId) : getSocket();
  if (!sock) {
    throw new Error("Nomor WA belum terhubung, tidak bisa mengirim reaksi.");
  }
  await sock.sendMessage(waJid, { react: { text: emoji, key: targetKey } });
  logger.info({ waJid, channel, extraAccountId, emoji }, "Reaksi kotak masuk terkirim ke warga");
}
