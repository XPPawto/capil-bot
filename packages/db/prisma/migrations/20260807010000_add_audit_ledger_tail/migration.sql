-- Baris tunggal penunjuk "ujung rantai" ledger - dikunci lewat SELECT...FOR UPDATE saat
-- menyambung entri baru (lihat komentar model AuditLedgerTail di schema.prisma dan
-- appendLedgerEntry di packages/db/src/auditLedger.ts).
CREATE TABLE `AuditLedgerTail` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `lastHash` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Diisi dengan hash entri TERAKHIR yang sudah ada di rantai saat ini (atau GENESIS_HASH -
-- 64 nol - kalau ledger masih kosong), supaya entri baru pertama setelah migrasi ini tetap
-- nyambung dengan benar ke rantai yang sudah ada, bukan mulai dari nol lagi.
INSERT INTO `AuditLedgerTail` (`id`, `lastHash`)
SELECT 1, COALESCE(
    (SELECT `hash` FROM `AuditLedgerEntry` ORDER BY `id` DESC LIMIT 1),
    '0000000000000000000000000000000000000000000000000000000000000000'
);
