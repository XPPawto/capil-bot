-- Dukungan chat grup untuk InboxMessage (khusus channel SECONDARY - akun nomor kedua yang
-- bukan bot). Satu percakapan grup berisi banyak pengirim berbeda, jadi perlu kolom
-- terpisah untuk mencatat siapa pengirim tiap pesan dalam grup itu.
ALTER TABLE `InboxMessage`
  ADD COLUMN `isGroup` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `groupName` VARCHAR(191) NULL,
  ADD COLUMN `senderNumber` VARCHAR(191) NULL,
  ADD COLUMN `senderName` VARCHAR(191) NULL;
