-- CreateTable
CREATE TABLE `attachment_assets` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `uploaderId` VARCHAR(191) NOT NULL,
    `storageType` VARCHAR(191) NOT NULL DEFAULT 'local',
    `storageKey` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `extension` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'uploaded',
    `previewStatus` VARCHAR(191) NOT NULL DEFAULT 'none',
    `previewKey` VARCHAR(191) NULL,
    `previewError` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attachment_bindings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `draftId` VARCHAR(191) NULL,
    `submissionId` VARCHAR(191) NULL,
    `fieldKey` VARCHAR(191) NULL,
    `bindScope` VARCHAR(191) NOT NULL,
    `phase` VARCHAR(191) NOT NULL,
    `versionNo` INTEGER NOT NULL DEFAULT 1,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `attachment_assets_tenantId_uploaderId_idx` ON `attachment_assets`(`tenantId`, `uploaderId`);

-- CreateIndex
CREATE INDEX `attachment_assets_tenantId_status_idx` ON `attachment_assets`(`tenantId`, `status`);

-- CreateIndex
CREATE INDEX `attachment_bindings_tenantId_assetId_idx` ON `attachment_bindings`(`tenantId`, `assetId`);

-- CreateIndex
CREATE INDEX `attachment_bindings_tenantId_sessionId_idx` ON `attachment_bindings`(`tenantId`, `sessionId`);

-- CreateIndex
CREATE INDEX `attachment_bindings_tenantId_draftId_idx` ON `attachment_bindings`(`tenantId`, `draftId`);

-- CreateIndex
CREATE INDEX `attachment_bindings_tenantId_submissionId_idx` ON `attachment_bindings`(`tenantId`, `submissionId`);

-- CreateIndex
CREATE INDEX `attachment_bindings_tenantId_fieldKey_idx` ON `attachment_bindings`(`tenantId`, `fieldKey`);

-- AddForeignKey
ALTER TABLE `attachment_bindings`
    ADD CONSTRAINT `attachment_bindings_assetId_fkey`
    FOREIGN KEY (`assetId`) REFERENCES `attachment_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment_bindings`
    ADD CONSTRAINT `attachment_bindings_sessionId_fkey`
    FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment_bindings`
    ADD CONSTRAINT `attachment_bindings_draftId_fkey`
    FOREIGN KEY (`draftId`) REFERENCES `process_drafts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment_bindings`
    ADD CONSTRAINT `attachment_bindings_submissionId_fkey`
    FOREIGN KEY (`submissionId`) REFERENCES `submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
