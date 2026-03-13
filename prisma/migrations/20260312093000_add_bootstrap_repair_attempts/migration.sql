-- CreateTable
CREATE TABLE `bootstrap_repair_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `flowCode` VARCHAR(191) NOT NULL,
    `attemptNo` INTEGER NOT NULL,
    `triggerReason` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `confidence` DOUBLE NULL,
    `proposedPatch` JSON NULL,
    `appliedPatch` JSON NULL,
    `result` JSON NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bootstrap_repair_attempts_bootstrapJobId_flowCode_attemptNo_key`(`bootstrapJobId`, `flowCode`, `attemptNo`),
    INDEX `bootstrap_repair_attempts_bootstrapJobId_flowCode_idx`(`bootstrapJobId`, `flowCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bootstrap_repair_attempts` ADD CONSTRAINT `bootstrap_repair_attempts_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
