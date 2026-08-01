-- AlterTable
ALTER TABLE `Request` ADD COLUMN `pickupReminderSentAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `StaffContact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `waNumber` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
