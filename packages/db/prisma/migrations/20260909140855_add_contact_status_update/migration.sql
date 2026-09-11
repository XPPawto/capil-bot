-- CreateTable
CREATE TABLE `ContactStatusUpdate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `waJid` VARCHAR(191) NOT NULL,
    `waNumber` VARCHAR(191) NOT NULL,
    `channel` ENUM('SERVICE', 'EXTRA') NOT NULL,
    `extraAccountId` INTEGER NOT NULL DEFAULT 0,
    `contentType` VARCHAR(191) NOT NULL,
    `text` TEXT NULL,
    `attachmentPath` VARCHAR(191) NULL,
    `attachmentMimeType` VARCHAR(191) NULL,
    `postedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ContactStatusUpdate_channel_extraAccountId_waJid_postedAt_idx`(`channel`, `extraAccountId`, `waJid`, `postedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
