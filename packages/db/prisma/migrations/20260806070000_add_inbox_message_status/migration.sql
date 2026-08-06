-- Status centang WA (SENT/DELIVERED/READ) untuk pesan keluar di Pesan Masuk
ALTER TABLE `InboxMessage` ADD COLUMN `status` VARCHAR(191) NULL;
