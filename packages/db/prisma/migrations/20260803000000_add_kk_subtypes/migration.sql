-- AlterTable: tambah 3 sub-jenis Kartu Keluarga ke enum ServiceType (dipakai di 3 tabel
-- terpisah karena MySQL enum inline per kolom, bukan tipe bersama)
ALTER TABLE `Request` MODIFY COLUMN `serviceType` ENUM('KARTU_KELUARGA', 'KK_BARCODE', 'KK_PISAH', 'KK_TAMBAH_ANGGOTA', 'AKTE_KEMATIAN', 'AKTE_KELAHIRAN') NOT NULL;

ALTER TABLE `RequirementTemplate` MODIFY COLUMN `serviceType` ENUM('KARTU_KELUARGA', 'KK_BARCODE', 'KK_PISAH', 'KK_TAMBAH_ANGGOTA', 'AKTE_KEMATIAN', 'AKTE_KELAHIRAN') NOT NULL;

ALTER TABLE `TicketSequence` MODIFY COLUMN `serviceType` ENUM('KARTU_KELUARGA', 'KK_BARCODE', 'KK_PISAH', 'KK_TAMBAH_ANGGOTA', 'AKTE_KEMATIAN', 'AKTE_KELAHIRAN') NOT NULL;
