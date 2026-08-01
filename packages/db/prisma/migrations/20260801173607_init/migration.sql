-- CreateTable
CREATE TABLE `Admin` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Admin_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `adminId` INTEGER NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_adminId_idx`(`adminId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BotSession` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `waJid` VARCHAR(191) NULL,
    `phoneNumber` VARCHAR(191) NULL,
    `connected` BOOLEAN NOT NULL DEFAULT false,
    `lastConnectedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationState` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `waJid` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `requirementsSnapshot` JSON NULL,
    `contextJson` JSON NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ConversationState_waJid_key`(`waJid`),
    INDEX `ConversationState_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequirementTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serviceType` ENUM('KARTU_KELUARGA', 'AKTE_KEMATIAN', 'AKTE_KELAHIRAN') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `order` INTEGER NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RequirementTemplate_serviceType_idx`(`serviceType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Request` (
    `id` VARCHAR(191) NOT NULL,
    `serviceType` ENUM('KARTU_KELUARGA', 'AKTE_KEMATIAN', 'AKTE_KELAHIRAN') NOT NULL,
    `applicantName` VARCHAR(191) NOT NULL,
    `waJid` VARCHAR(191) NOT NULL,
    `waNumber` VARCHAR(191) NOT NULL,
    `status` ENUM('DICEK', 'DIPROSES', 'DITOLAK', 'SELESAI') NOT NULL DEFAULT 'DICEK',
    `rejectionReason` VARCHAR(191) NULL,
    `pickupToken` VARCHAR(191) NOT NULL,
    `pickupTokenUsedAt` DATETIME(3) NULL,
    `qrGeneratedAt` DATETIME(3) NULL,
    `pickupConfirmedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `notifiedStatus` ENUM('DICEK', 'DIPROSES', 'DITOLAK', 'SELESAI') NULL,
    `notifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Request_pickupToken_key`(`pickupToken`),
    INDEX `Request_waJid_idx`(`waJid`),
    INDEX `Request_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequestDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` VARCHAR(191) NOT NULL,
    `requirementName` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `filePath` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RequestDocument_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatusHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` VARCHAR(191) NOT NULL,
    `status` ENUM('DICEK', 'DIPROSES', 'DITOLAK', 'SELESAI') NOT NULL,
    `note` VARCHAR(191) NULL,
    `changedById` INTEGER NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StatusHistory_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequestDocument` ADD CONSTRAINT `RequestDocument_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `Request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StatusHistory` ADD CONSTRAINT `StatusHistory_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `Request`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StatusHistory` ADD CONSTRAINT `StatusHistory_changedById_fkey` FOREIGN KEY (`changedById`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
