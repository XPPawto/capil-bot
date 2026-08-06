import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../src/index";
import { appendLedgerEntry } from "../src/auditLedger";

/**
 * Dijalankan SEKALI saat fitur ledger audit ini pertama diaktifkan - mengisi jejak ledger
 * untuk baris InboxMessage yang SUDAH ADA sebelum fitur ini dibangun (kalau tidak, riwayat
 * lama akan terlihat "tidak ada di ledger", padahal cuma soal fitur ini belum ada waktu itu).
 *
 * PENTING - keterbatasan yang wajib dipahami: entri yang dibuat backfill ini merekam kondisi
 * baris SAAT BACKFILL DIJALANKAN, bukan bukti bahwa baris itu belum pernah diubah SEBELUM
 * backfill (itu memang mustahil dibuktikan tanpa hash yang diambil sejak pesan pertama
 * dicatat). Yang bisa dibuktikan dengan pasti oleh ledger ini adalah: tidak ada perubahan
 * pada baris mana pun (lama maupun baru) SEJAK backfill ini dijalankan.
 *
 * Aman dijalankan ulang - baris yang sudah pernah dapat jejak ledger dilewati (idempotent).
 *
 * Cara pakai (dari root repo): npm run backfill-audit-ledger --workspace=@kelurahan/db
 */
async function main(): Promise<void> {
  const uploadDir = path.resolve(process.cwd(), "../..", process.env.UPLOAD_DIR ?? "./storage/uploads");
  const fileKeyHex = process.env.FILE_ENCRYPTION_KEY;
  const fileKey = fileKeyHex && fileKeyHex.length === 64 ? Buffer.from(fileKeyHex, "hex") : null;

  const alreadyLedgered = new Set(
    (await prisma.auditLedgerEntry.findMany({ where: { eventType: "MESSAGE_CREATED" }, select: { inboxMessageId: true } })).map(
      (r) => r.inboxMessageId
    )
  );

  const rows = await prisma.inboxMessage.findMany({ orderBy: { id: "asc" } });

  let created = 0;
  let skipped = 0;
  let fileHashed = 0;
  let fileHashFailed = 0;

  for (const row of rows) {
    if (alreadyLedgered.has(row.id)) {
      skipped++;
      continue;
    }

    let attachmentSha256: string | null = null;
    if (row.attachmentPath && fileKey) {
      try {
        const absolutePath = path.resolve(uploadDir, row.attachmentPath);
        const raw = await fs.promises.readFile(absolutePath);
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const encrypted = raw.subarray(28);
        const decipher = crypto.createDecipheriv("aes-256-gcm", fileKey, iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        attachmentSha256 = crypto.createHash("sha256").update(plain).digest("hex");
        fileHashed++;
      } catch {
        fileHashFailed++;
      }
    }

    await appendLedgerEntry("MESSAGE_CREATED", row.id, {
      waJid: row.waJid,
      waNumber: row.waNumber,
      channel: row.channel,
      extraAccountId: row.extraAccountId,
      direction: row.direction,
      message: row.message,
      attachmentPath: row.attachmentPath,
      attachmentMimeType: row.attachmentMimeType,
      attachmentSha256,
      isGroup: row.isGroup,
      isChannel: row.isChannel,
      groupName: row.groupName,
      senderNumber: row.senderNumber,
      senderName: row.senderName,
      adminId: row.adminId,
      waMessageId: row.waMessageId,
      createdAt: row.createdAt.toISOString(),
    });

    // Kalau baris ini SUDAH pernah diedit/berubah status sebelum backfill, rekam juga
    // kondisi TERKINI-nya sebagai entri menyusul - supaya field itu ikut diawasi ledger
    // mulai sekarang (bukan cuma dianggap "belum pernah diperiksa").
    if (row.editedAt) {
      await appendLedgerEntry("MESSAGE_EDITED", row.id, { newMessage: row.message, editedAt: row.editedAt.toISOString() });
    }
    if (row.status) {
      await appendLedgerEntry("STATUS_CHANGED", row.id, { newStatus: row.status });
    }

    created++;
  }

  console.log(
    `Backfill ledger selesai. ${created} pesan lama baru diberi jejak ledger (${fileHashed} lampiran berhasil di-hash, ${fileHashFailed} gagal dibaca/didekripsi), ${skipped} sudah pernah punya jejak sebelumnya.`
  );
}

main()
  .catch((err) => {
    console.error("Backfill ledger gagal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
