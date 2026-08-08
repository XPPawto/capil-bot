import { PrismaClient } from "@prisma/client";

/**
 * Jalur break-glass MANUAL untuk sakelar gembok /admin-xpawto (Time-Based Kill Switch) -
 * dipakai kalau bot/Telegram tidak bisa dijangkau (token hilang, bot down, dsb) dan gembok
 * perlu dibuka/ditutup tanpa lewat perintah Telegram sama sekali. SENGAJA tidak ada rute API
 * atau tombol UI mana pun yang bisa melakukan ini - harus dijalankan manual, langsung di
 * server, oleh orang yang memang punya akses shell ke situ.
 *
 * Cara pakai (jalankan dari root repo, lewat npm workspace):
 *
 *   # Buka 10 menit:
 *   npm run set-master-lock --workspace=@kelurahan/db -- unlock 10m
 *
 *   # Kunci sekarang juga:
 *   npm run set-master-lock --workspace=@kelurahan/db -- lock
 *
 *   # Lihat status saat ini:
 *   npm run set-master-lock --workspace=@kelurahan/db -- status
 */
// Sama seperti apps/bot/src/notify/telegramCommands.ts - durasi SENGAJA bebas (bukan
// dipatok ke angka tertentu), batas di sini murni jaga-jaga angka tidak masuk akal.
const DURATION_RE = /^(\d+)\s*(s|m|h|d)$/i;
const MAX_UNLOCK_MS = 365 * 24 * 60 * 60_000;

function parseDurationMs(input: string): number {
  const m = DURATION_RE.exec(input.trim());
  if (!m) throw new Error(`Format durasi tidak dikenali: "${input}". Contoh: 5m, 30m, 2h, 3d.`);
  const amount = Number(m[1]);
  const unit = m[2].toLowerCase();
  const multiplier = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 60 * 60_000 : 24 * 60 * 60_000;
  const ms = amount * multiplier;
  if (ms <= 0 || ms > MAX_UNLOCK_MS) throw new Error(`Durasi harus antara >0 dan 365d, dapat: "${input}".`);
  return ms;
}

async function main(): Promise<void> {
  const [action, arg] = process.argv.slice(2);
  const prisma = new PrismaClient();
  try {
    if (action === "unlock") {
      if (!arg) throw new Error("Sertakan durasi, contoh: unlock 10m");
      const ms = parseDurationMs(arg);
      const unlockedUntil = new Date(Date.now() + ms);
      await prisma.adminLockState.upsert({
        where: { id: 1 },
        create: { id: 1, unlockedUntil },
        update: { unlockedUntil },
      });
      console.log(`Terbuka sampai ${unlockedUntil.toISOString()}.`);
    } else if (action === "lock") {
      await prisma.adminLockState.upsert({
        where: { id: 1 },
        create: { id: 1, unlockedUntil: null },
        update: { unlockedUntil: null },
      });
      console.log("Terkunci.");
    } else if (action === "status") {
      const row = await prisma.adminLockState.findUnique({ where: { id: 1 } });
      const unlockedUntil = row?.unlockedUntil ?? null;
      const unlocked = unlockedUntil !== null && unlockedUntil.getTime() > Date.now();
      console.log(unlocked ? `Terbuka sampai ${unlockedUntil!.toISOString()}.` : "Terkunci.");
    } else {
      throw new Error('Aksi tidak dikenali. Pakai: "unlock <durasi>", "lock", atau "status".');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
