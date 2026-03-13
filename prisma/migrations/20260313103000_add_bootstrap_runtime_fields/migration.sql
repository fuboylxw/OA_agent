-- AlterTable
ALTER TABLE `bootstrap_jobs`
    ADD COLUMN `queueJobId` VARCHAR(191) NULL,
    ADD COLUMN `currentStage` VARCHAR(191) NULL,
    ADD COLUMN `stageStartedAt` DATETIME(3) NULL,
    ADD COLUMN `lastHeartbeatAt` DATETIME(3) NULL,
    ADD COLUMN `recoveryAttemptCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `reconcileAttemptCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `stalledReason` TEXT NULL,
    ADD COLUMN `lastError` TEXT NULL;

-- CreateIndex
CREATE INDEX `bootstrap_jobs_queueJobId_idx` ON `bootstrap_jobs`(`queueJobId`);

-- CreateIndex
CREATE INDEX `bootstrap_jobs_status_lastHeartbeatAt_idx` ON `bootstrap_jobs`(`status`, `lastHeartbeatAt`);
