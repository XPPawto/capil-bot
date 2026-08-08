-- Reaksi emoji ke pesan - satu baris per (pesan, pereaksi), lihat komentar model di
-- schema.prisma.
CREATE TABLE `MessageReaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `inboxMessageId` INTEGER NOT NULL,
    `reactorJid` VARCHAR(191) NOT NULL,
    `reactorName` VARCHAR(191) NULL,
    `emoji` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MessageReaction_inboxMessageId_idx`(`inboxMessageId`),
    UNIQUE INDEX `MessageReaction_inboxMessageId_reactorJid_key`(`inboxMessageId`, `reactorJid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MessageReaction` ADD CONSTRAINT `MessageReaction_inboxMessageId_fkey` FOREIGN KEY (`inboxMessageId`) REFERENCES `InboxMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
