import QRCode from "qrcode";
import { customAlphabet } from "nanoid";
import { prisma } from "@kelurahan/db";
import { serviceLabel } from "../conversation/menu";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { humanSendMessage } from "../wa/humanSend";
import { estimateProcessingMinutes, formatEstimatedWait } from "./estimateWaitTime";

const pickupTokenAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 10);

/**
 * Dipanggil baik oleh control server (fast path, saat admin ubah status)
 * maupun reconciler (retry path). Selalu baca ulang Request dari DB
 * (source of truth) supaya kedua caller konsisten.
 */
export async function sendStatusMessage(requestId: string): Promise<void> {
  const sock = getSocket();
  if (!sock) {
    throw new Error("Bot WA belum terhubung, tidak bisa mengirim notifikasi.");
  }

  const req = await prisma.request.findUnique({ where: { id: requestId } });
  if (!req) return;
  if (req.notifiedStatus === req.status) return; // sudah pernah terkirim untuk status ini

  const label = serviceLabel(req.serviceType);

  if (req.status === "DIPROSES") {
    // Regenerasi token tiap kali masuk DIPROSES supaya QR lama (mis. screenshot) tidak berlaku lagi.
    const pickupToken = pickupTokenAlphabet();
    await prisma.request.update({
      where: { id: req.id },
      data: { pickupToken, pickupTokenUsedAt: null, qrGeneratedAt: new Date() },
    });
    const qrBuffer = await QRCode.toBuffer(pickupToken, { margin: 1, width: 400 });

    const estimateMinutes = await estimateProcessingMinutes(req.serviceType).catch(() => null);
    const estimateText =
      estimateMinutes !== null
        ? `\n\nEstimasi: berdasarkan riwayat pengajuan lain, dokumen Anda biasanya siap dalam sekitar *${formatEstimatedWait(
            estimateMinutes
          )}* (bisa lebih cepat/lambat tergantung antrian saat ini).`
        : "";

    await humanSendMessage(sock, req.waJid, {
      image: qrBuffer,
      caption:
        `Pengajuan *${label}* Anda (No. Tiket: *${req.ticketNumber}*) sedang *diproses*.\n\n` +
        `Simpan QR ini - nanti akan kami kabari lagi begitu dokumennya sudah siap diambil di kantor kelurahan.` +
        estimateText,
    });
  } else if (req.status === "DITOLAK") {
    await humanSendMessage(sock, req.waJid, {
      text:
        `Mohon maaf, pengajuan *${label}* Anda (No. Tiket: *${req.ticketNumber}*) *ditolak*.\n` +
        `Alasan: ${req.rejectionReason ?? "-"}\n\n` +
        `Kalau cuma sebagian syarat yang perlu diperbaiki, ketik *perbaiki ${req.ticketNumber}* - syarat yang sudah benar tidak perlu dikirim ulang.\n` +
        `Atau ketik *menu* untuk mengajukan dari awal.`,
    });
  } else if (req.status === "SELESAI") {
    await humanSendMessage(sock, req.waJid, {
      text:
        `Dokumen *${label}* Anda (No. Tiket: *${req.ticketNumber}*) telah *selesai* diambil. ` +
        `Terima kasih telah menggunakan layanan kami.\n\n` +
        `Mohon balas pesan ini dengan angka *1-5* untuk menilai kepuasan Anda (5 = Sangat Puas).`,
    });
  } else {
    return;
  }

  await prisma.request.update({
    where: { id: req.id },
    data: {
      notifiedStatus: req.status,
      notifiedAt: new Date(),
      ratingRequestedAt: req.status === "SELESAI" ? new Date() : req.ratingRequestedAt,
    },
  });
  logger.info({ requestId: req.id, status: req.status }, "Notifikasi status terkirim ke warga");
}
