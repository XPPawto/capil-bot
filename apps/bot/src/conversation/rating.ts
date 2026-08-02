import { prisma } from "@kelurahan/db";

const RATING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Jendela waktu balasan angka 1-5 dianggap rating (bukan pilihan menu layanan baru) -
 * cuma aktif kalau ada pengajuan SELESAI yang baru saja diminta rating-nya dan belum
 * dijawab, dan tidak lebih dari 24 jam sejak diminta (supaya angka polos tak sengaja
 * ketik lama kemudian tidak salah dianggap rating pengajuan lama).
 */
export async function findPendingRating(waJid: string) {
  return prisma.request.findFirst({
    where: {
      waJid,
      status: "SELESAI",
      ratingRequestedAt: { not: null, gte: new Date(Date.now() - RATING_WINDOW_MS) },
      ratingSubmittedAt: null,
    },
    orderBy: { ratingRequestedAt: "desc" },
  });
}

export async function submitRating(requestId: string, rating: number): Promise<void> {
  await prisma.request.update({
    where: { id: requestId },
    data: { rating, ratingSubmittedAt: new Date() },
  });
}

/** Dipanggil saat warga eksplisit "pindah topik" (ketik *menu*) supaya balasan angka berikutnya tidak salah dianggap rating pengajuan lama. */
export async function expirePendingRating(waJid: string): Promise<void> {
  const pending = await findPendingRating(waJid);
  if (pending) {
    await prisma.request.update({ where: { id: pending.id }, data: { ratingRequestedAt: null } });
  }
}
