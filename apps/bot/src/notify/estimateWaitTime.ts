import { prisma, ServiceType, type Prisma } from "@kelurahan/db";

const SAMPLE_SIZE = 100;
const MIN_SAMPLES = 5;

/**
 * Rata-rata durasi DIPROSES -> SELESAI (BUKAN DICEK -> SELESAI) dari pengajuan yang sudah
 * kelar, dipakai sebagai estimasi "sisa waktu sampai siap diambil" tepat saat status masuk
 * DIPROSES - waktu review DICEK yang sudah lewat tidak relevan lagi buat pemohon di titik ini.
 */
async function averageMinutes(where: Prisma.RequestWhereInput): Promise<number | null> {
  const rows = await prisma.request.findMany({
    where: { ...where, status: "SELESAI", completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: SAMPLE_SIZE,
    select: {
      completedAt: true,
      statusHistories: {
        where: { status: "DIPROSES" },
        orderBy: { changedAt: "asc" },
        take: 1,
        select: { changedAt: true },
      },
    },
  });

  const durationsMs = rows
    .filter((r) => r.completedAt && r.statusHistories.length > 0)
    .map((r) => r.completedAt!.getTime() - r.statusHistories[0].changedAt.getTime())
    .filter((ms) => ms > 0);

  if (durationsMs.length < MIN_SAMPLES) return null;

  const avgMs = durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length;
  return Math.round(avgMs / 60_000);
}

/**
 * Diprioritaskan pakai riwayat layanan yang sama (mis. Akte Kematian biasanya lebih cepat
 * karena prioritas antrian) - fallback ke rata-rata semua layanan kalau data spesifik
 * layanan itu belum cukup (kantor baru pakai sistem ini / layanan itu jarang diajukan).
 * Sengaja return null (bukan angka asal) kalau sampel historis masih terlalu sedikit -
 * estimasi ngawur lebih buruk daripada tidak ada estimasi sama sekali.
 */
export async function estimateProcessingMinutes(serviceType: ServiceType): Promise<number | null> {
  const bySameService = await averageMinutes({ serviceType });
  if (bySameService !== null) return bySameService;
  return averageMinutes({});
}

export function formatEstimatedWait(minutes: number): string {
  if (minutes < 1) return "kurang dari 1 menit";
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) return remMinutes > 0 ? `${hours} jam ${remMinutes} menit` : `${hours} jam`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} hari ${remHours} jam` : `${days} hari`;
}
