-- Lampiran (foto/dokumen) opsional pada pesan kotak masuk, baik yang dikirim warga
-- maupun yang dikirim petugas lewat halaman Pesan Masuk.
ALTER TABLE `InboxMessage`
  ADD COLUMN `attachmentPath` VARCHAR(191) NULL,
  ADD COLUMN `attachmentMimeType` VARCHAR(191) NULL;
