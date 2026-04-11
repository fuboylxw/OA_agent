-- DropForeignKey
ALTER TABLE `process_drafts` DROP FOREIGN KEY `process_drafts_templateId_fkey`;

-- DropForeignKey
ALTER TABLE `process_templates` DROP FOREIGN KEY `process_templates_connectorId_fkey`;

-- DropForeignKey
ALTER TABLE `process_templates` DROP FOREIGN KEY `process_templates_remoteProcessId_fkey`;

-- DropForeignKey
ALTER TABLE `process_templates` DROP FOREIGN KEY `process_templates_supersedesId_fkey`;

-- AlterTable
ALTER TABLE `connector_capabilities` MODIFY `supportsDiscovery` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `connectors` ADD COLUMN `statusMapping` JSON NULL,
    ADD COLUMN `syncStrategy` JSON NULL;

-- AlterTable
ALTER TABLE `submissions` ADD COLUMN `lastSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `syncFailCount` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `sync_logs` (
    `id` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NULL,
    `syncType` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `statusBefore` VARCHAR(191) NULL,
    `statusAfter` VARCHAR(191) NULL,
    `remoteRaw` JSON NULL,
    `error` TEXT NULL,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sync_logs_connectorId_createdAt_idx`(`connectorId`, `createdAt`),
    INDEX `sync_logs_submissionId_idx`(`submissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `process_templates` ADD CONSTRAINT `process_templates_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_templates` ADD CONSTRAINT `process_templates_remoteProcessId_fkey` FOREIGN KEY (`remoteProcessId`) REFERENCES `remote_processes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_templates` ADD CONSTRAINT `process_templates_supersedesId_fkey` FOREIGN KEY (`supersedesId`) REFERENCES `process_templates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_drafts` ADD CONSTRAINT `process_drafts_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `process_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `process_templates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_logs` ADD CONSTRAINT `sync_logs_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
