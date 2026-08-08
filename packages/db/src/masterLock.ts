import { prisma } from "./index";

/**
 * Sakelar gembok utama /admin-xpawto ("Time-Based Kill Switch") - lihat komentar model
 * AdminLockState di schema.prisma untuk desain lengkapnya. Dipakai bersama dari dua proses:
 * apps/bot MENULIS (lewat perintah Telegram /unlock & /lock, lihat
 * apps/bot/src/notify/telegramCommands.ts) dan apps/web MEMBACA (menggerbangi login PIN+TOTP
 * maupun sesi yang sudah berjalan, lihat lib/accessControl.ts).
 */
export async function isMasterUnlocked(): Promise<{ unlocked: boolean; unlockedUntil: Date | null }> {
  const row = await prisma.adminLockState.findUnique({ where: { id: 1 } });
  const unlockedUntil = row?.unlockedUntil ?? null;
  // Self-expiring - dibandingkan ke waktu sekarang tiap dipanggil, BUKAN sebuah flag boolean
  // terpisah yang perlu "dimatikan lagi" oleh proses lain. Ini yang menjamin gembok otomatis
  // tertutup sendiri walau tidak ada apa pun yang secara aktif menutupnya kembali.
  const unlocked = unlockedUntil !== null && unlockedUntil.getTime() > Date.now();
  return { unlocked, unlockedUntil };
}

export async function unlockMasterFor(ms: number): Promise<Date> {
  const unlockedUntil = new Date(Date.now() + ms);
  await prisma.adminLockState.upsert({
    where: { id: 1 },
    create: { id: 1, unlockedUntil },
    update: { unlockedUntil },
  });
  return unlockedUntil;
}

export async function lockMasterNow(): Promise<void> {
  await prisma.adminLockState.upsert({
    where: { id: 1 },
    create: { id: 1, unlockedUntil: null },
    update: { unlockedUntil: null },
  });
}
