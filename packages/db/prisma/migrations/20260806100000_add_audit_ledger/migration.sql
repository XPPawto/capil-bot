-- Buku besar audit berantai (hash chain), APPEND-ONLY - lihat komentar pada model di
-- schema.prisma dan packages/db/src/auditLedger.ts untuk penjelasan lengkap.
CREATE TABLE `AuditLedgerEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventType` VARCHAR(191) NOT NULL,
    `inboxMessageId` INTEGER NOT NULL,
    `payload` LONGTEXT NOT NULL,
    `prevHash` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AuditLedgerEntry_prevHash_key`(`prevHash`),
    UNIQUE INDEX `AuditLedgerEntry_hash_key`(`hash`),
    INDEX `AuditLedgerEntry_inboxMessageId_idx`(`inboxMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
