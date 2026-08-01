import { prisma } from "@kelurahan/db";
import { serviceLabel } from "../conversation/menu";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";

/**
 * Notifikasi terpisah dari "diproses" - QR pengambilan sudah dikirim sejak status
 * masuk DIPROSES, tapi itu belum tentu berarti dokumen fisiknya sudah jadi. Ini
 * dikirim manual oleh admin (bisa berkali-kali/resend) saat dokumen benar-benar
 * siap diambil, supaya warga tahu kapan harus datang ke kantor.
 */
export async function sendReadyForPickupMessage(requestId: string): Promise<void> {
  const sock = getSocket();
  if (!sock) {
    throw new Error("Bot WA belum terhubung, tidak bisa mengirim notifikasi.");
  }

  const req = await prisma.request.findUnique({ where: { id: requestId } });
  if (!req) return;
  if (req.status !== "DIPROSES") {
    logger.warn({ requestId, status: req.status }, "Lewati notifikasi siap diambil: status sudah berubah");
    return;
  }
  if (!req.readyForPickupRequestedAt) return; // belum pernah diminta admin
  if (req.readyForPickupSentAt && req.readyForPickupSentAt >= req.readyForPickupRequestedAt) {
    return; // sudah terkirim untuk permintaan (resend) terakhir
  }

  const label = serviceLabel(req.serviceType);
  await sock.sendMessage(req.waJid, {
    text:
      `Kabar baik! Dokumen *${label}* Anda (No. Tiket: *${req.ticketNumber}*) sudah *siap diambil* ` +
      `di kantor kelurahan.\n\nJangan lupa bawa QR yang sudah kami kirim sebelumnya untuk ditunjukkan ke petugas.`,
  });

  await prisma.request.update({
    where: { id: req.id },
    data: { readyForPickupSentAt: new Date() },
  });
  logger.info({ requestId: req.id }, "Notifikasi siap diambil terkirim ke warga");
}
