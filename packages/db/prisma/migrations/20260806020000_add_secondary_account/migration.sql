-- Nomor WA kedua (perangkat tertaut manual, bukan bot) + kolom channel pada InboxMessage
-- supaya percakapan lewat nomor layanan dan nomor kedua tidak tercampur.
CREATE TABLE `SecondaryAccountSession` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `waJid` VARCHAR(191) NULL,
  `phoneNumber` VARCHAR(191) NULL,
  `connected` BOOLEAN NOT NULL DEFAULT false,
  `lastConnectedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `InboxMessage`
  ADD COLUMN `channel` ENUM('SERVICE', 'SECONDARY') NOT NULL DEFAULT 'SERVICE';

CREATE INDEX `InboxMessage_channel_idx` ON `InboxMessage`(`channel`);
