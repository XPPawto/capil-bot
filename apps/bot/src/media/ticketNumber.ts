import { prisma, ServiceType } from "@kelurahan/db";

const SERVICE_CODE: Record<ServiceType, string> = {
  KARTU_KELUARGA: "KK",
  KK_BARCODE: "KKB",
  KK_PISAH: "KKP",
  KK_TAMBAH_ANGGOTA: "KKA",
  AKTE_KEMATIAN: "AM",
  AKTE_KELAHIRAN: "AL",
};

/**
 * Nomor tiket yang mudah dibacakan warga ke petugas (mis. KK-2608-0001), berbeda
 * dari id internal (cuid/nanoid) yang tidak manusiawi. Urutan per layanan+bulan
 * di-increment atomik lewat trik MySQL "INSERT ... ON DUPLICATE KEY UPDATE
 * lastNumber = LAST_INSERT_ID(lastNumber + 1)" di dalam satu transaksi (supaya
 * kedua statement pasti pakai koneksi yang sama) - aman dari race condition
 * kalau dua pengajuan pada layanan & bulan yang sama selesai hampir bersamaan.
 */
export async function generateTicketNumber(serviceType: ServiceType): Promise<string> {
  const now = new Date();
  const yearMonth = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const code = SERVICE_CODE[serviceType];

  const seq = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO TicketSequence (serviceType, yearMonth, lastNumber)
      VALUES (${serviceType}, ${yearMonth}, 1)
      ON DUPLICATE KEY UPDATE lastNumber = LAST_INSERT_ID(lastNumber + 1)
    `;
    const rows = await tx.$queryRaw<{ seq: bigint | number }[]>`SELECT LAST_INSERT_ID() as seq`;
    return Number(rows[0].seq);
  });

  return `${code}-${yearMonth}-${String(seq).padStart(4, "0")}`;
}
