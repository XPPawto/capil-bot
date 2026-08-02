-- CreateTable
CREATE TABLE `SecurityLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ip` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `field` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `pattern` VARCHAR(191) NOT NULL,
    `userAgent` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SecurityLog_createdAt_idx`(`createdAt`),
    INDEX `SecurityLog_ip_idx`(`ip`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
