-- Sakelar gembok utama /admin-xpawto (Time-Based Kill Switch) - lihat komentar model
-- AdminLockState di schema.prisma. Baris id=1 langsung diseed TERKUNCI (unlockedUntil NULL)
-- supaya defaultnya aman sejak baris pertama ada, tidak menunggu upsert pertama kali dipakai.
CREATE TABLE `AdminLockState` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `unlockedUntil` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `AdminLockState` (`id`, `unlockedUntil`, `updatedAt`) VALUES (1, NULL, CURRENT_TIMESTAMP(3));
