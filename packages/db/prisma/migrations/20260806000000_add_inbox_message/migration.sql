-- CreateTable
CREATE TABLE `InboxMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `waJid` VARCHAR(191) NOT NULL,
    `waNumber` VARCHAR(191) NOT NULL,
    `direction` ENUM('OUTBOUND', 'INBOUND') NOT NULL,
    `message` TEXT NOT NULL,
    `adminId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InboxMessage_waJid_idx`(`waJid`),
    INDEX `InboxMessage_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `InboxMessage` ADD CONSTRAINT `InboxMessage_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
