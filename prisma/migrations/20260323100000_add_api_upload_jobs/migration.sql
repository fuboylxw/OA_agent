-- CreateTable
CREATE TABLE `api_upload_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `sourceName` VARCHAR(191) NULL,
    `sourceHash` VARCHAR(191) NOT NULL,
    `sourceContent` LONGTEXT NOT NULL,
    `docType` VARCHAR(191) NOT NULL,
    `oaUrl` VARCHAR(191) NULL,
    `authConfig` JSON NULL,
    `autoValidate` BOOLEAN NOT NULL DEFAULT true,
    `autoGenerateMcp` BOOLEAN NOT NULL DEFAULT true,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `currentAttemptNo` INTEGER NOT NULL DEFAULT 0,
    `finalDecision` VARCHAR(191) NULL,
    `finalErrorType` VARCHAR(191) NULL,
    `finalErrorMessage` TEXT NULL,
    `acceptedContent` LONGTEXT NULL,
    `acceptedContentHash` VARCHAR(191) NULL,
    `acceptedEndpointCount` INTEGER NULL,
    `acceptedWorkflowCount` INTEGER NULL,
    `acceptedValidationScore` DOUBLE NULL,
    `uploadResult` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `api_upload_jobs_tenantId_connectorId_idx`(`tenantId`, `connectorId`),
    INDEX `api_upload_jobs_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_upload_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NOT NULL,
    `attemptNo` INTEGER NOT NULL,
    `stage` VARCHAR(191) NOT NULL,
    `strategy` VARCHAR(191) NOT NULL,
    `inputContent` LONGTEXT NOT NULL,
    `inputHash` VARCHAR(191) NOT NULL,
    `outputContent` LONGTEXT NULL,
    `outputHash` VARCHAR(191) NULL,
    `diagnostics` JSON NULL,
    `repairActions` JSON NULL,
    `parseSuccess` BOOLEAN NOT NULL DEFAULT false,
    `endpointCount` INTEGER NOT NULL DEFAULT 0,
    `workflowCount` INTEGER NOT NULL DEFAULT 0,
    `validationScore` DOUBLE NULL,
    `decision` VARCHAR(191) NOT NULL,
    `errorType` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `api_upload_attempts_jobId_attemptNo_key`(`jobId`, `attemptNo`),
    INDEX `api_upload_attempts_jobId_decision_idx`(`jobId`, `decision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `api_upload_jobs` ADD CONSTRAINT `api_upload_jobs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_upload_jobs` ADD CONSTRAINT `api_upload_jobs_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_upload_attempts` ADD CONSTRAINT `api_upload_attempts_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `api_upload_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
