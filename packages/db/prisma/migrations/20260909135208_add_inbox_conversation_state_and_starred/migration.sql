-- AlterTable
ALTER TABLE `InboxMessage` ADD COLUMN `starredAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `InboxConversationState` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `waJid` VARCHAR(191) NOT NULL,
    `channel` ENUM('SERVICE', 'EXTRA') NOT NULL,
    `extraAccountId` INTEGER NOT NULL DEFAULT 0,
    `pinnedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `manualUnreadAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InboxConversationState_waJid_channel_extraAccountId_key`(`waJid`, `channel`, `extraAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `InboxMessage_channel_extraAccountId_starredAt_idx` ON `InboxMessage`(`channel`, `extraAccountId`, `starredAt`);
