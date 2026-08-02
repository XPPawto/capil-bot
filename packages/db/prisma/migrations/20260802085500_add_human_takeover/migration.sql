-- CreateTable
CREATE TABLE `HumanTakeover` (
    `waJid` VARCHAR(191) NOT NULL,
    `activatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `adminId` INTEGER NULL,

    PRIMARY KEY (`waJid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `HumanTakeover` ADD CONSTRAINT `HumanTakeover_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
