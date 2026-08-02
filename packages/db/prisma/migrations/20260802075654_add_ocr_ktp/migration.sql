-- AlterTable
ALTER TABLE `RequestDocument` ADD COLUMN `ocrNik` VARCHAR(191) NULL,
    ADD COLUMN `ocrRawText` TEXT NULL;

-- AlterTable
ALTER TABLE `RequirementTemplate` ADD COLUMN `ocrKtp` BOOLEAN NOT NULL DEFAULT false;
