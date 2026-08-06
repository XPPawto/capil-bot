import type { InboxChannel } from "@kelurahan/db";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { getSecondarySocket } from "../wa/secondarySocket";
import { humanSendMessage } from "../wa/humanSend";
import { markAsSentByDashboard } from "../wa/sentMessageTracker";

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
  const sent = await humanSendMessage(sock, waJid, { text: message });
  // Supaya echo "fromMe" dari pesan ini sendiri tidak ikut dicatat dobel oleh
  // secondaryMessageHandler.ts (yang sekarang juga menangkap balasan langsung dari HP).
  markAsSentByDashboard(sent?.key?.id);
  logger.info({ waJid, channel }, "Balasan kotak masuk terkirim ke warga");
}
