-- DropForeignKey
ALTER TABLE `CallLog` DROP FOREIGN KEY `CallLog_extraAccountId_fkey`;

-- DropForeignKey
ALTER TABLE `InboxMessage` DROP FOREIGN KEY `InboxMessage_adminId_fkey`;

-- DropForeignKey
ALTER TABLE `InboxMessage` DROP FOREIGN KEY `InboxMessage_extraAccountId_fkey`;

-- DropForeignKey
ALTER TABLE `MessageReaction` DROP FOREIGN KEY `MessageReaction_inboxMessageId_fkey`;

-- AlterTable
ALTER TABLE `Admin` DROP COLUMN `pinFailedCount`,
    DROP COLUMN `pinLockedUntil`;

-- DropTable
DROP TABLE `AccessControl`;

-- DropTable
DROP TABLE `AdminLockState`;

-- DropTable
DROP TABLE `AuditLedgerEntry`;

-- DropTable
DROP TABLE `AuditLedgerTail`;

-- DropTable
DROP TABLE `CallLog`;

-- DropTable
DROP TABLE `ContactAvatar`;

-- DropTable
DROP TABLE `ContactStatusUpdate`;

-- DropTable
DROP TABLE `ExtraAccount`;

-- DropTable
DROP TABLE `InboxConversationState`;

-- DropTable
DROP TABLE `InboxMessage`;

-- DropTable
DROP TABLE `MessageReaction`;

-- DropTable
DROP TABLE `SecondaryAccountSession`;

