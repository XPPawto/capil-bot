import { prisma } from "@kelurahan/db";

/**
 * Kalau true, bot harus diam total untuk waJid ini - petugas sedang mengambil alih
 * percakapan lewat dashboard. Dicek di messageHandler.ts SEBELUM pesan masuk ke
 * handleConversationMessage, supaya tidak ada balasan otomatis (menu/status/dsb) yang
 * bentrok dengan apa yang sedang diketik petugas secara manual.
 */
export async function isHumanTakeoverActive(waJid: string): Promise<boolean> {
  const row = await prisma.humanTakeover.findUnique({ where: { waJid } });
  return row !== null;
}

/**
 * Dipanggil saat warga chat bebas di luar alur formulir (bot tidak mengenali sebagai
 * command/pilihan layanan). Kalau warga punya pengajuan aktif, catat pesannya supaya
 * petugas bisa lihat di dashboard sebagai konteks percakapan - mis. warga tanya
 * "kapan selesai ya?" saat pengajuannya masih DICEK/DIPROSES.
 */
export async function logInboundIfActiveRequest(waJid: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  const active = await prisma.request.findFirst({
    where: { waJid, status: { in: ["DICEK", "DIPROSES"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!active) return;

  await prisma.requestMessage.create({
    data: { requestId: active.id, direction: "INBOUND", message: trimmed },
  });
}
