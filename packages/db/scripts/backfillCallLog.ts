import { prisma } from "../src/index";

/**
 * Dijalankan SEKALI - mengisi tabel CallLog untuk baris InboxMessage "[Panggilan ...]" yang
 * SUDAH ADA sebelum tabel CallLog ini dibangun (lihat komentar model CallLog di
 * schema.prisma). Tanpa ini, panggilan yang tercatat sebelum fitur tab "Riwayat Panggilan"
 * ada tidak akan pernah muncul di tab itu - CallLog cuma mulai terisi otomatis untuk
 * panggilan BARU sejak fitur itu di-deploy, riwayat lama diam-diam ketinggalan di
 * InboxMessage saja.
 *
 * Format teks yang di-parse: "[Panggilan suara|video masuk - <outcome>]" (lihat
 * logInboxCallEvent lama sebelum CallLog ada, di conversation/messageLog.ts).
 * createdAt DIPERTAHANKAN dari baris InboxMessage aslinya (bukan waktu backfill dijalankan)
 * supaya urutan kronologis di tab tetap benar.
 *
 * Aman dijalankan ulang - baris yang sudah pernah di-backfill (dicek lewat kombinasi
 * waJid+channel+extraAccountId+outcome+isVideo+createdAt yang identik) dilewati.
 *
 * Cara pakai (dari root repo): npm run backfill-call-log --workspace=@kelurahan/db
 */
const CALL_MESSAGE_RE = /^\[Panggilan (suara|video) masuk - (.+)\]$/;

async function main(): Promise<void> {
  const rows = await prisma.inboxMessage.findMany({
    where: { message: { startsWith: "[Panggilan" } },
    orderBy: { id: "asc" },
  });

  const existing = await prisma.callLog.findMany();
  const existingKey = new Set(
    existing.map((r) => `${r.waJid}|${r.channel}|${r.extraAccountId ?? ""}|${r.outcome}|${r.isVideo}|${r.createdAt.getTime()}`)
  );

  let created = 0;
  let skippedExisting = 0;
  let skippedUnparsed = 0;

  for (const row of rows) {
    const match = CALL_MESSAGE_RE.exec(row.message);
    if (!match) {
      skippedUnparsed++;
      console.warn(`Dilewati (format tidak cocok): InboxMessage#${row.id} - "${row.message}"`);
      continue;
    }
    const isVideo = match[1] === "video";
    const outcome = match[2];

    const key = `${row.waJid}|${row.channel}|${row.extraAccountId ?? ""}|${outcome}|${isVideo}|${row.createdAt.getTime()}`;
    if (existingKey.has(key)) {
      skippedExisting++;
      continue;
    }

    await prisma.callLog.create({
      data: {
        waJid: row.waJid,
        waNumber: row.waNumber,
        channel: row.channel,
        extraAccountId: row.extraAccountId,
        isVideo,
        isGroup: row.isGroup,
        groupName: row.groupName,
        outcome,
        createdAt: row.createdAt,
      },
    });
    existingKey.add(key);
    created++;
  }

  console.log(`Selesai. Dibuat: ${created}, sudah ada (dilewati): ${skippedExisting}, format tak dikenal (dilewati): ${skippedUnparsed}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
