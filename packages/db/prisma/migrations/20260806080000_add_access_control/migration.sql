-- Lockout percobaan PIN /admin-xpawto (terpisah dari lockout login username+password)
ALTER TABLE `Admin` ADD COLUMN `pinFailedCount` INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `Admin` ADD COLUMN `pinLockedUntil` DATETIME(3) NULL;

-- Singleton kredensial gerbang tambahan (PIN hash + daftar IP terpercaya terenkripsi).
-- Tidak diisi lewat migrasi ini - lihat packages/db/scripts/setAccessControl.ts.
CREATE TABLE `AccessControl` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `pinHash` VARCHAR(191) NOT NULL,
    `networkBlob` LONGBLOB NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
