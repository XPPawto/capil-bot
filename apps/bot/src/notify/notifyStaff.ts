import type { WASocket } from "@whiskeysockets/baileys";
import { prisma, ServiceType } from "@kelurahan/db";
import { serviceLabel } from "../conversation/menu";
import { logger } from "../logger";

function toJid(waNumber: string): string {
  return `${waNumber.replace(/\D/g, "")}@s.whatsapp.net`;
}

/**
 * Dipanggil sinkron dari finalize.ts tepat setelah Request baru (status DICEK)
 * dibuat. Bot pasti sedang terhubung di titik ini (baru saja menerima pesan dari
 * warga yang memicu ini), jadi tidak perlu jalur retry/reconciler terpisah seperti
 * notifikasi status ke warga - cukup try/catch per kontak supaya satu nomor gagal
 * tidak menghalangi notifikasi ke kontak lain.
 */
export async function notifyStaffNewRequest(
  sock: WASocket,
  params: { ticketNumber: string; serviceType: ServiceType; applicantName: string; waNumber: string }
): Promise<void> {
  const contacts = await prisma.staffContact.findMany({ where: { active: true } });
  if (contacts.length === 0) return;

  const text =
    `Pengajuan baru masuk:\n` +
    `No. Tiket: *${params.ticketNumber}*\n` +
    `Layanan: ${serviceLabel(params.serviceType)}\n` +
    `Pemohon: ${params.applicantName}\n` +
    `Nomor WA: ${params.waNumber}\n\n` +
    `Silakan cek dashboard untuk memproses.`;

  for (const contact of contacts) {
    try {
      await sock.sendMessage(toJid(contact.waNumber), { text });
    } catch (err) {
      logger.warn({ err, contact: contact.waNumber }, "Gagal kirim notifikasi pengajuan baru ke petugas");
    }
  }
}
