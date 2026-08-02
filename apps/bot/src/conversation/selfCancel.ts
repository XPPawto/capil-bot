import { prisma } from "@kelurahan/db";
import { serviceLabel } from "./menu";
import { STATUS_LABEL } from "./statusLabel";

/**
 * Dipicu warga lewat command global "batal <nomor tiket>" (beda dari "batal" polos
 * yang membatalkan proses upload yang sedang berjalan). Ini membatalkan pengajuan
 * yang SUDAH terkirim, selama masih berstatus DICEK - supaya warga yang sadar salah
 * upload tidak perlu menunggu petugas menolak manual, dan antrian tidak numpuk
 * data yang memang sudah tidak diinginkan pengajunya sendiri.
 */
export async function selfCancelRequest(waJid: string, rawTicket: string): Promise<string> {
  const ticketNumber = rawTicket.trim().toUpperCase();
  const request = await prisma.request.findUnique({ where: { ticketNumber } });

  if (!request || request.waJid !== waJid) {
    return `Nomor tiket *${ticketNumber}* tidak ditemukan pada riwayat pengajuan Anda. Ketik *status* untuk lihat daftar tiket Anda.`;
  }

  if (request.status !== "DICEK") {
    return (
      `Pengajuan *${ticketNumber}* sudah berstatus *${STATUS_LABEL[request.status]}* dan tidak bisa dibatalkan ` +
      `sendiri lagi. Hubungi petugas kalau perlu bantuan.`
    );
  }

  await prisma.$transaction([
    prisma.request.update({
      where: { id: request.id },
      data: {
        status: "DITOLAK",
        rejectionReason: "Dibatalkan sendiri oleh warga",
        notifiedStatus: "DITOLAK",
        notifiedAt: new Date(),
      },
    }),
    prisma.statusHistory.create({
      data: { requestId: request.id, status: "DITOLAK", note: "Dibatalkan sendiri oleh warga lewat chat bot" },
    }),
  ]);

  return (
    `Pengajuan *${ticketNumber}* (${serviceLabel(request.serviceType)}) berhasil dibatalkan.\n\n` +
    `Ketik *menu* kalau ingin mengajukan lagi.`
  );
}
