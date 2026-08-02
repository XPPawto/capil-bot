-- AlterTable
ALTER TABLE `Request` ADD COLUMN `rating` INTEGER NULL,
    ADD COLUMN `ratingRequestedAt` DATETIME(3) NULL,
    ADD COLUMN `ratingSubmittedAt` DATETIME(3) NULL;
