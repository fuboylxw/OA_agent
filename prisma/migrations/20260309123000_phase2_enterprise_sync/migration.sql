-- CreateTable
CREATE TABLE `connector_secret_refs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `secretProvider` VARCHAR(191) NOT NULL,
    `secretPath` VARCHAR(191) NOT NULL,
    `secretVersion` VARCHAR(191) NULL,
    `rotationStatus` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastRotatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `connector_secret_refs_connectorId_key`(`connectorId`),
    INDEX `connector_secret_refs_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `connector_capabilities` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `supportsDiscovery` BOOLEAN NOT NULL DEFAULT true,
    `supportsSchemaSync` BOOLEAN NOT NULL DEFAULT false,
    `supportsReferenceSync` BOOLEAN NOT NULL DEFAULT false,
    `supportsStatusPull` BOOLEAN NOT NULL DEFAULT false,
    `supportsWebhook` BOOLEAN NOT NULL DEFAULT false,
    `supportsCancel` BOOLEAN NOT NULL DEFAULT false,
    `supportsUrge` BOOLEAN NOT NULL DEFAULT false,
    `supportsDelegate` BOOLEAN NOT NULL DEFAULT false,
    `supportsSupplement` BOOLEAN NOT NULL DEFAULT false,
    `supportsRealtimePerm` BOOLEAN NOT NULL DEFAULT false,
    `supportsIdempotency` BOOLEAN NOT NULL DEFAULT false,
    `syncModes` JSON NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `connector_capabilities_connectorId_key`(`connectorId`),
    INDEX `connector_capabilities_tenantId_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remote_processes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `remoteProcessId` VARCHAR(191) NOT NULL,
    `remoteProcessCode` VARCHAR(191) NULL,
    `remoteProcessName` VARCHAR(191) NOT NULL,
    `processCategory` VARCHAR(191) NULL,
    `sourceVersion` VARCHAR(191) NULL,
    `sourceHash` VARCHAR(191) NOT NULL,
    `latestTemplateId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `metadata` JSON NULL,
    `discoveredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSchemaSyncAt` DATETIME(3) NULL,
    `lastDriftCheckAt` DATETIME(3) NULL,

    UNIQUE INDEX `remote_processes_connectorId_remoteProcessId_key`(`connectorId`, `remoteProcessId`),
    INDEX `remote_processes_tenantId_connectorId_idx`(`tenantId`, `connectorId`),
    INDEX `remote_processes_sourceHash_idx`(`sourceHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reference_datasets` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `datasetCode` VARCHAR(191) NOT NULL,
    `datasetName` VARCHAR(191) NOT NULL,
    `datasetType` VARCHAR(191) NOT NULL,
    `syncMode` VARCHAR(191) NOT NULL,
    `sourceHash` VARCHAR(191) NULL,
    `sourceVersion` VARCHAR(191) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reference_datasets_connectorId_datasetCode_key`(`connectorId`, `datasetCode`),
    INDEX `reference_datasets_tenantId_datasetType_idx`(`tenantId`, `datasetType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reference_items` (
    `id` VARCHAR(191) NOT NULL,
    `datasetId` VARCHAR(191) NOT NULL,
    `remoteItemId` VARCHAR(191) NULL,
    `itemKey` VARCHAR(191) NOT NULL,
    `itemLabel` VARCHAR(191) NOT NULL,
    `itemValue` VARCHAR(191) NULL,
    `parentKey` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reference_items_datasetId_itemKey_idx`(`datasetId`, `itemKey`),
    INDEX `reference_items_datasetId_remoteItemId_idx`(`datasetId`, `remoteItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `submission_events` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `eventSource` VARCHAR(191) NOT NULL,
    `remoteEventId` VARCHAR(191) NULL,
    `eventTime` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `submission_events_submissionId_eventSource_remoteEventId_key`(`submissionId`, `eventSource`, `remoteEventId`),
    INDEX `submission_events_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `submission_events_submissionId_eventTime_idx`(`submissionId`, `eventTime`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_cursors` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `syncDomain` VARCHAR(191) NOT NULL,
    `cursorType` VARCHAR(191) NOT NULL,
    `cursorValue` LONGTEXT NULL,
    `lastVersion` VARCHAR(191) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastFailureAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sync_cursors_connectorId_syncDomain_key`(`connectorId`, `syncDomain`),
    INDEX `sync_cursors_tenantId_syncDomain_idx`(`tenantId`, `syncDomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sync_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `syncDomain` VARCHAR(191) NOT NULL,
    `triggerType` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `scope` JSON NULL,
    `cursorSnapshot` JSON NULL,
    `result` JSON NULL,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sync_jobs_connectorId_syncDomain_status_idx`(`connectorId`, `syncDomain`, `status`),
    INDEX `sync_jobs_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_inboxes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(191) NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `headers` JSON NULL,
    `payload` JSON NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    `processStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `errorMessage` TEXT NULL,

    UNIQUE INDEX `webhook_inboxes_dedupeKey_key`(`dedupeKey`),
    INDEX `webhook_inboxes_connectorId_processStatus_idx`(`connectorId`, `processStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `process_templates`
    ADD COLUMN `remoteProcessId` VARCHAR(191) NULL,
    ADD COLUMN `sourceHash` VARCHAR(191) NULL,
    ADD COLUMN `sourceVersion` VARCHAR(191) NULL,
    ADD COLUMN `reviewStatus` VARCHAR(191) NOT NULL DEFAULT 'approved',
    ADD COLUMN `changeSummary` JSON NULL,
    ADD COLUMN `supersedesId` VARCHAR(191) NULL,
    ADD COLUMN `lastSyncedAt` DATETIME(3) NULL,
    ADD COLUMN `publishedBy` VARCHAR(191) NULL;

-- RedefineIndex
DROP INDEX `process_templates_tenantId_processCode_version_key` ON `process_templates`;

-- CreateIndex
CREATE UNIQUE INDEX `process_templates_connectorId_processCode_version_key` ON `process_templates`(`connectorId`, `processCode`, `version`);

-- CreateIndex
CREATE INDEX `process_templates_connectorId_remoteProcessId_version_idx` ON `process_templates`(`connectorId`, `remoteProcessId`, `version`);

-- AddForeignKey
ALTER TABLE `connector_secret_refs` ADD CONSTRAINT `connector_secret_refs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `connector_secret_refs` ADD CONSTRAINT `connector_secret_refs_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `connector_capabilities` ADD CONSTRAINT `connector_capabilities_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `connector_capabilities` ADD CONSTRAINT `connector_capabilities_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_processes` ADD CONSTRAINT `remote_processes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remote_processes` ADD CONSTRAINT `remote_processes_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reference_datasets` ADD CONSTRAINT `reference_datasets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reference_datasets` ADD CONSTRAINT `reference_datasets_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reference_items` ADD CONSTRAINT `reference_items_datasetId_fkey` FOREIGN KEY (`datasetId`) REFERENCES `reference_datasets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_templates` ADD CONSTRAINT `process_templates_remoteProcessId_fkey` FOREIGN KEY (`remoteProcessId`) REFERENCES `remote_processes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_templates` ADD CONSTRAINT `process_templates_supersedesId_fkey` FOREIGN KEY (`supersedesId`) REFERENCES `process_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submission_events` ADD CONSTRAINT `submission_events_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submission_events` ADD CONSTRAINT `submission_events_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_cursors` ADD CONSTRAINT `sync_cursors_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_cursors` ADD CONSTRAINT `sync_cursors_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_jobs` ADD CONSTRAINT `sync_jobs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sync_jobs` ADD CONSTRAINT `sync_jobs_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_inboxes` ADD CONSTRAINT `webhook_inboxes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_inboxes` ADD CONSTRAINT `webhook_inboxes_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
