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
