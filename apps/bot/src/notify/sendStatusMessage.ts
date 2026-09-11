import QRCode from "qrcode";
import { prisma } from "@kelurahan/db";
import { serviceLabel } from "../conversation/menu";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";
import { humanSendMessage } from "../wa/humanSend";
import { estimateProcessingMinutes, formatEstimatedWait } from "./estimateWaitTime";

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
    // Token QR sudah digenerate SEKALI saat transisi status di dashboard (api/requests/[id]/
    // status) - dipakai apa adanya di sini, TIDAK diregenerasi. Fungsi ini bisa dipanggil
    // ulang oleh reconciler; regenerasi di titik ini dulu membuat QR yang sudah dipegang warga
    // mendadak tidak valid pada retry. Sekarang pengiriman ulang mengirim QR yang sama persis.
    const qrBuffer = await QRCode.toBuffer(req.pickupToken, { margin: 1, width: 400 });

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
