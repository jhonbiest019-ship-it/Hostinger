-- AlterTable
ALTER TABLE `Template` ADD COLUMN `isDefault` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `Template_userId_isDefault_idx` ON `Template`(`userId`, `isDefault`);
