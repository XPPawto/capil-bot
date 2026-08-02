import { prisma } from "@kelurahan/db";
import { serviceLabel } from "./menu";
import { STATUS_LABEL } from "./statusLabel";

/**
 * Dipicu warga lewat command global "status" - tidak menyentuh ConversationState
 * sama sekali, supaya bisa dicek kapan saja tanpa mengganggu proses upload syarat
 * yang mungkin sedang berjalan.
 */
export async function buildStatusReport(waJid: string): Promise<string> {
  const requests = await prisma.request.findMany({
    where: { waJid },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  if (requests.length === 0) {
    return "Anda belum memiliki pengajuan tercatat. Ketik *menu* untuk memulai pengajuan.";
  }

  const lines = requests.map((r, idx) => {
    const parts = [
      `${idx + 1}. *${r.ticketNumber}* - ${serviceLabel(r.serviceType)}`,
      `   Status: ${STATUS_LABEL[r.status]}`,
    ];
    if (r.status === "DITOLAK" && r.rejectionReason) {
      parts.push(`   Alasan: ${r.rejectionReason}`);
    }
    if (r.status === "DIPROSES") {
      parts.push(
        r.readyForPickupSentAt
          ? "   Sudah *siap diambil* di kantor kelurahan."
          : "   Masih diproses, belum siap diambil."
      );
    }
    return parts.join("\n");
  });

  const hasCancellable = requests.some((r) => r.status === "DICEK");
  const cancelHint = hasCancellable
    ? `\n\nMasih *dicek* dan salah upload? Ketik *batal <nomor tiket>* untuk membatalkannya, mis. *batal ${requests.find((r) => r.status === "DICEK")?.ticketNumber}*.`
    : "";

  return `Berikut status pengajuan Anda:\n\n${lines.join("\n\n")}${cancelHint}\n\nKetik *menu* untuk mengajukan layanan baru.`;
}
