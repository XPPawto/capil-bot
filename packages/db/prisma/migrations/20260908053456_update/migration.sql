-- DropForeignKey
ALTER TABLE `MessageReaction` DROP FOREIGN KEY `MessageReaction_inboxMessageId_fkey`;

-- AlterTable
ALTER TABLE `AuditLedgerEntry` MODIFY `payload` TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE `MessageReaction` ADD CONSTRAINT `MessageReaction_inboxMessageId_fkey` FOREIGN KEY (`inboxMessageId`) REFERENCES `InboxMessage`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
