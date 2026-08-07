-- Tandai pesan yang dihapus pengirim (protocolMessage REVOKE) - konten tidak dihapus, cuma
-- ditandai (lihat komentar model di schema.prisma).
ALTER TABLE `InboxMessage` ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- Koordinat share-lokasi/live-location untuk pratinjau peta di UI.
ALTER TABLE `InboxMessage` ADD COLUMN `latitude` DOUBLE NULL;
ALTER TABLE `InboxMessage` ADD COLUMN `longitude` DOUBLE NULL;
