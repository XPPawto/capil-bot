-- AddColumn (nullable dulu supaya bisa dibackfill sebelum jadi NOT NULL + UNIQUE)
ALTER TABLE `Request` ADD COLUMN `ticketNumber` VARCHAR(191) NULL;
ALTER TABLE `Request` ADD COLUMN `readyForPickupRequestedAt` DATETIME(3) NULL;
ALTER TABLE `Request` ADD COLUMN `readyForPickupSentAt` DATETIME(3) NULL;

-- Backfill data yang sudah ada sebelum kolom ini ditambahkan (3 baris hasil uji coba)
UPDATE `Request` SET `ticketNumber` = 'KK-2608-0001' WHERE `id` = 'ImBbu79sSvKCk6Tl84uFV';
UPDATE `Request` SET `ticketNumber` = 'AM-2608-0001' WHERE `id` = 'Fn0QN20IuXiayM-gGRy5H';
UPDATE `Request` SET `ticketNumber` = 'KK-2608-0002' WHERE `id` = 'fmtEsZQc3ykPvP4eAiXA7';

-- Jadikan wajib diisi + unik setelah backfill
ALTER TABLE `Request` MODIFY COLUMN `ticketNumber` VARCHAR(191) NOT NULL;
ALTER TABLE `Request` ADD UNIQUE INDEX `Request_ticketNumber_key`(`ticketNumber`);

-- CreateTable
CREATE TABLE `TicketSequence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `serviceType` ENUM('KARTU_KELUARGA', 'AKTE_KEMATIAN', 'AKTE_KELAHIRAN') NOT NULL,
    `yearMonth` VARCHAR(191) NOT NULL,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `TicketSequence_serviceType_yearMonth_key`(`serviceType`, `yearMonth`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Samakan penghitung dengan data yang sudah dibackfill di atas, supaya tiket berikutnya lanjut dari sini
INSERT INTO `TicketSequence` (`serviceType`, `yearMonth`, `lastNumber`) VALUES ('KARTU_KELUARGA', '2608', 2);
INSERT INTO `TicketSequence` (`serviceType`, `yearMonth`, `lastNumber`) VALUES ('AKTE_KEMATIAN', '2608', 1);
