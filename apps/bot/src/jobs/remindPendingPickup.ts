import { prisma } from "@kelurahan/db";
import { serviceLabel } from "../conversation/menu";
import { logger } from "../logger";
import { getSocket } from "../wa/socket";

const INTERVAL_MS = 60 * 60 * 1000; // cek tiap 1 jam
const REMINDER_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // 3 hari sejak notifikasi siap-diambil

/**
 * Dokumen yang sudah dikabari "siap diambil" tapi tak kunjung diambil warga akan
 * menumpuk di kantor. Job ini mengingatkan sekali (ditandai pickupReminderSentAt
 * supaya tidak nge-spam) setelah 3 hari berlalu tanpa pickupConfirmedAt.
 */
export function startPickupReminderJob(): void {
  setInterval(() => {
    runOnce().catch((err) => logger.error({ err }, "Gagal menjalankan reminder pengambilan dokumen"));
  }, INTERVAL_MS);
}

async function runOnce(): Promise<void> {
  const sock = getSocket();
  if (!sock) return; // tidak terhubung, coba lagi siklus berikutnya

  const threshold = new Date(Date.now() - REMINDER_THRESHOLD_MS);
  const candidates = await prisma.request.findMany({
    where: {
      status: "DIPROSES",
      readyForPickupSentAt: { not: null, lte: threshold },
      pickupReminderSentAt: null,
    },
  });

  for (const req of candidates) {
    try {
      await sock.sendMessage(req.waJid, {
        text:
          `Halo, ini pengingat: dokumen *${serviceLabel(req.serviceType)}* Anda (No. Tiket: *${req.ticketNumber}*) ` +
          `sudah *siap diambil* di kantor kelurahan sejak beberapa hari lalu.\n\n` +
          `Silakan segera diambil dengan menunjukkan QR yang sudah kami kirim sebelumnya.`,
      });
      await prisma.request.update({ where: { id: req.id }, data: { pickupReminderSentAt: new Date() } });
      logger.info({ requestId: req.id }, "Reminder pengambilan dokumen terkirim");
    } catch (err) {
      logger.warn({ err, requestId: req.id }, "Gagal kirim reminder pengambilan, dicoba lagi siklus berikutnya");
    }
  }
}
