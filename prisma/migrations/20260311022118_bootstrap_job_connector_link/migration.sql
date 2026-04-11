-- AlterTable
ALTER TABLE `bootstrap_jobs` ADD COLUMN `connectorId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `bootstrap_jobs_connectorId_idx` ON `bootstrap_jobs`(`connectorId`);

-- AddForeignKey
ALTER TABLE `bootstrap_jobs` ADD CONSTRAINT `bootstrap_jobs_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
