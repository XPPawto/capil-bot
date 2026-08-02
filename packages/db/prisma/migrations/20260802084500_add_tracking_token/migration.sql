-- AlterTable
ALTER TABLE `Request` ADD COLUMN `trackingToken` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Request_trackingToken_key` ON `Request`(`trackingToken`);
