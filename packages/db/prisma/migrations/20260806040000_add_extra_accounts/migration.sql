-- Ganti SecondaryAccountSession (singleton, cuma 1 akun tambahan) dengan ExtraAccount
-- (banyak baris, bisa Akun Kedua/Ketiga/dst). Data akun kedua yang sudah ada dipindahkan
-- apa adanya, begitu juga InboxMessage yang sudah tercatat untuknya.

CREATE TABLE `ExtraAccount` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `label` VARCHAR(191) NOT NULL,
  `waJid` VARCHAR(191) NULL,
  `phoneNumber` VARCHAR(191) NULL,
  `connected` BOOLEAN NOT NULL DEFAULT false,
  `lastConnectedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- Pindahkan akun kedua yang sudah ada (kalau pernah pernah disambungkan) jadi baris
-- ExtraAccount pertama, supaya id-nya bisa dipakai untuk backfill InboxMessage di bawah.
INSERT INTO `ExtraAccount` (`label`, `waJid`, `phoneNumber`, `connected`, `lastConnectedAt`, `updatedAt`)
SELECT 'Akun Kedua', `waJid`, `phoneNumber`, `connected`, `lastConnectedAt`, `updatedAt`
FROM `SecondaryAccountSession`
WHERE `id` = 1;

-- Perluas enum dulu supaya nilai lama & baru bisa hidup berdampingan sementara backfill.
ALTER TABLE `InboxMessage`
  MODIFY COLUMN `channel` ENUM('SERVICE', 'SECONDARY', 'EXTRA') NOT NULL DEFAULT 'SERVICE';

ALTER TABLE `InboxMessage`
  ADD COLUMN `extraAccountId` INTEGER NULL;

-- Semua pesan yang dulu channel SECONDARY sekarang jadi EXTRA, ditautkan ke ExtraAccount
-- yang baru dibuat (asumsi cuma ada 1 akun kedua sebelumnya, sesuai desain lama).
UPDATE `InboxMessage`
SET `channel` = 'EXTRA', `extraAccountId` = (SELECT `id` FROM `ExtraAccount` ORDER BY `id` ASC LIMIT 1)
WHERE `channel` = 'SECONDARY';

-- Sekarang aman menyempitkan enum lagi ke set final.
ALTER TABLE `InboxMessage`
  MODIFY COLUMN `channel` ENUM('SERVICE', 'EXTRA') NOT NULL DEFAULT 'SERVICE';

CREATE INDEX `InboxMessage_extraAccountId_idx` ON `InboxMessage`(`extraAccountId`);

ALTER TABLE `InboxMessage`
  ADD CONSTRAINT `InboxMessage_extraAccountId_fkey` FOREIGN KEY (`extraAccountId`) REFERENCES `ExtraAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
