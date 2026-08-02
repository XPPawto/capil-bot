import { prisma, ServiceType } from "@kelurahan/db";
import { serviceLabel } from "./menu";
import { STATUS_LABEL } from "./statusLabel";
import { estimateProcessingMinutes, formatEstimatedWait } from "../notify/estimateWaitTime";

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
    include: {
      statusHistories: { where: { status: "DIPROSES" }, orderBy: { changedAt: "desc" }, take: 1 },
    },
  });

  if (requests.length === 0) {
    return "Anda belum memiliki pengajuan tercatat. Ketik *menu* untuk memulai pengajuan.";
  }

  // Prefetch estimasi per layanan sekali saja (bukan per baris) - request yang masih
  // diproses & belum siap diambil kemungkinan berbeda-beda layanannya.
  const pendingServiceTypes = [
    ...new Set(
      requests.filter((r) => r.status === "DIPROSES" && !r.readyForPickupSentAt).map((r) => r.serviceType)
    ),
  ];
  const estimateByService = new Map<ServiceType, number | null>(
    await Promise.all(
      pendingServiceTypes.map(async (s): Promise<[ServiceType, number | null]> => [s, await estimateProcessingMinutes(s)])
    )
  );

  const lines = requests.map((r, idx) => {
    const parts = [
      `${idx + 1}. *${r.ticketNumber}* - ${serviceLabel(r.serviceType)}`,
      `   Status: ${STATUS_LABEL[r.status]}`,
    ];
    if (r.status === "DITOLAK" && r.rejectionReason) {
      parts.push(`   Alasan: ${r.rejectionReason}`);
    }
    if (r.status === "DIPROSES") {
      if (r.readyForPickupSentAt) {
        parts.push("   Sudah *siap diambil* di kantor kelurahan.");
      } else {
        const diprosesAt = r.statusHistories[0]?.changedAt;
        const avgMinutes = estimateByService.get(r.serviceType) ?? null;
        const remaining =
          diprosesAt && avgMinutes !== null
            ? avgMinutes - Math.floor((Date.now() - diprosesAt.getTime()) / 60_000)
            : null;
        parts.push(
          remaining !== null && remaining > 5
            ? `   Masih diproses, estimasi sekitar *${formatEstimatedWait(remaining)}* lagi.`
            : "   Masih diproses, belum siap diambil."
        );
      }
    }
    return parts.join("\n");
  });

  const hasCancellable = requests.some((r) => r.status === "DICEK");
  const cancelHint = hasCancellable
    ? `\n\nMasih *dicek* dan salah upload? Ketik *batal <nomor tiket>* untuk membatalkannya, mis. *batal ${requests.find((r) => r.status === "DICEK")?.ticketNumber}*.`
    : "";

  return `Berikut status pengajuan Anda:\n\n${lines.join("\n\n")}${cancelHint}\n\nKetik *menu* untuk mengajukan layanan baru.`;
}
