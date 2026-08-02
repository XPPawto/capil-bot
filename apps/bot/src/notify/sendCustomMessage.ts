import { prisma } from "@kelurahan/db";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { humanSendMessage } from "../wa/humanSend";

/**
 * Pesan bebas yang diketik petugas dari dashboard (klarifikasi, tanya-jawab kasus per
 * kasus) - beda dari template notifikasi status. Baris RequestMessage sudah dibuat di
 * sisi web (dia yang tahu admin mana yang kirim); di sini cukup kirim WA-nya.
 */
export async function sendCustomMessage(requestId: string, message: string): Promise<void> {
  const sock = getSocket();
  if (!sock) {
    throw new Error("Bot WA belum terhubung, tidak bisa mengirim pesan.");
  }

  const req = await prisma.request.findUnique({ where: { id: requestId } });
  if (!req) {
    throw new Error("Pengajuan tidak ditemukan.");
  }

  await humanSendMessage(sock, req.waJid, { text: message });
  logger.info({ requestId }, "Pesan bebas dari petugas terkirim ke warga");
}
