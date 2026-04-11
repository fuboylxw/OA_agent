-- CreateTable
CREATE TABLE `parse_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `documentType` VARCHAR(191) NOT NULL,
    `documentUrl` VARCHAR(191) NULL,
    `documentHash` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `parseOptions` JSON NOT NULL,
    `parseResult` JSON NULL,
    `parseMetadata` JSON NULL,
    `warnings` JSON NOT NULL,
    `errors` JSON NOT NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewComment` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `parse_jobs_tenantId_idx`(`tenantId`),
    INDEX `parse_jobs_bootstrapJobId_idx`(`bootstrapJobId`),
    INDEX `parse_jobs_status_idx`(`status`),
    INDEX `parse_jobs_documentHash_idx`(`documentHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `extracted_processes` (
    `id` VARCHAR(191) NOT NULL,
    `parseJobId` VARCHAR(191) NOT NULL,
    `processCode` VARCHAR(191) NOT NULL,
    `processName` VARCHAR(191) NOT NULL,
    `processCategory` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `confidence` DOUBLE NOT NULL,
    `endpoints` JSON NOT NULL,
    `fields` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `publishedTemplateId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `extracted_processes_parseJobId_idx`(`parseJobId`),
    INDEX `extracted_processes_processCode_idx`(`processCode`),
    INDEX `extracted_processes_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `parse_jobs` ADD CONSTRAINT `parse_jobs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `parse_jobs` ADD CONSTRAINT `parse_jobs_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `extracted_processes` ADD CONSTRAINT `extracted_processes_parseJobId_fkey` FOREIGN KEY (`parseJobId`) REFERENCES `parse_jobs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
