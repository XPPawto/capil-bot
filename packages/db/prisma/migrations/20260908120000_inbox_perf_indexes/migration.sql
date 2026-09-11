-- Index komposit untuk kueri "satu pesan terakhir per percakapan" (lib/inbox.ts) - lihat
-- komentar di schema.prisma. Mengganti index tunggal channel & waJid yang jadi prefix-nya.

-- DropIndex
DROP INDEX `InboxMessage_channel_idx` ON `InboxMessage`;

-- DropIndex
DROP INDEX `InboxMessage_waJid_idx` ON `InboxMessage`;

-- CreateIndex
CREATE INDEX `InboxMessage_channel_extraAccountId_waJid_id_idx` ON `InboxMessage`(`channel`, `extraAccountId`, `waJid`, `id`);

-- CreateIndex
CREATE INDEX `InboxMessage_channel_extraAccountId_direction_waJid_id_idx` ON `InboxMessage`(`channel`, `extraAccountId`, `direction`, `waJid`, `id`);

-- CreateIndex
CREATE INDEX `InboxMessage_waJid_channel_extraAccountId_createdAt_idx` ON `InboxMessage`(`waJid`, `channel`, `extraAccountId`, `createdAt`);
