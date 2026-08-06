import type { InboxChannel } from "@kelurahan/db";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { getSecondarySocket } from "../wa/secondarySocket";
import { humanSendMessage } from "../wa/humanSend";

/**
 * Balasan bebas dari petugas lewat halaman "Pesan Masuk" - beda dari sendCustomMessage
 * (yang terikat pada satu Request) karena di sini cuma butuh waJid mentah, warga yang
 * membalas bisa jadi belum pernah punya pengajuan sama sekali. `channel` menentukan socket
 * mana yang dipakai mengirim - nomor layanan (SERVICE) atau nomor kedua (SECONDARY).
 */
export async function sendInboxReply(waJid: string, message: string, channel: InboxChannel = "SERVICE"): Promise<void> {
  const sock = channel === "SECONDARY" ? getSecondarySocket() : getSocket();
  if (!sock) {
    throw new Error("Nomor WA belum terhubung, tidak bisa mengirim pesan.");
  }
  // ID pesan ini sudah otomatis ditandai di sentMessageTracker oleh humanSendMessage
  // sendiri (sebelum dikirim) - lihat wa/humanSend.ts - supaya echo "fromMe"-nya tidak
  // ikut dicatat dobel oleh messageHandler/secondaryMessageHandler.
  await humanSendMessage(sock, waJid, { text: message });
  logger.info({ waJid, channel }, "Balasan kotak masuk terkirim ke warga");
}
