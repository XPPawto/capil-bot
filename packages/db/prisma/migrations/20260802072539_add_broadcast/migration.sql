-- CreateTable
CREATE TABLE `Broadcast` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message` TEXT NOT NULL,
    `recipientCount` INTEGER NOT NULL,
    `adminId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Broadcast` ADD CONSTRAINT `Broadcast_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
