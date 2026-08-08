-- Label "Diteruskan" dan pratinjau balasan/kutipan pesan - lihat komentar kolom di
-- schema.prisma dan extractIsForwarded/extractQuotedInfo di apps/bot/src/conversation/messageHandler.ts.
ALTER TABLE `InboxMessage`
  ADD COLUMN `isForwarded` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `quotedWaMessageId` VARCHAR(191) NULL,
  ADD COLUMN `quotedPreview` VARCHAR(191) NULL;
