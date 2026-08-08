-- Riwayat panggilan (tab "Riwayat Panggilan") dan cache foto profil kontak - lihat komentar
-- model di schema.prisma.
CREATE TABLE `CallLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `waJid` VARCHAR(191) NOT NULL,
    `waNumber` VARCHAR(191) NOT NULL,
    `channel` ENUM('SERVICE', 'EXTRA') NOT NULL,
    `extraAccountId` INTEGER NULL,
    `isVideo` BOOLEAN NOT NULL,
    `isGroup` BOOLEAN NOT NULL DEFAULT false,
    `groupName` VARCHAR(191) NULL,
    `outcome` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CallLog_channel_extraAccountId_createdAt_idx`(`channel`, `extraAccountId`, `createdAt`),
    INDEX `CallLog_waJid_idx`(`waJid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CallLog` ADD CONSTRAINT `CallLog_extraAccountId_fkey` FOREIGN KEY (`extraAccountId`) REFERENCES `ExtraAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `ContactAvatar` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `waJid` VARCHAR(191) NOT NULL,
    `channel` ENUM('SERVICE', 'EXTRA') NOT NULL,
    `extraAccountId` INTEGER NOT NULL DEFAULT 0,
    `imagePath` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NULL,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ContactAvatar_waJid_channel_extraAccountId_key`(`waJid`, `channel`, `extraAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
