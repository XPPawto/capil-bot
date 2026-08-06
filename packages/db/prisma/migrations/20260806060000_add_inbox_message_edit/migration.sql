-- Dukungan edit pesan WA: simpan ID pesan asli supaya editnya bisa dicocokkan ke baris yang
-- tepat (update di tempat), bukan bikin baris baru atau menyentuh baris lain.
ALTER TABLE `InboxMessage`
  ADD COLUMN `waMessageId` VARCHAR(191) NULL,
  ADD COLUMN `editedAt` DATETIME(3) NULL;

CREATE INDEX `InboxMessage_waMessageId_idx` ON `InboxMessage`(`waMessageId`);
