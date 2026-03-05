-- CreateTable
CREATE TABLE `tenants` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenants_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `roles` JSON NOT NULL,
    `oaUserId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_tenantId_username_key`(`tenantId`, `username`),
    UNIQUE INDEX `users_tenantId_email_key`(`tenantId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bootstrap_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'CREATED',
    `oaUrl` VARCHAR(191) NULL,
    `sourceBundleUrl` VARCHAR(191) NULL,
    `openApiUrl` VARCHAR(191) NULL,
    `harFileUrl` VARCHAR(191) NULL,
    `uploadedFiles` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,

    INDEX `bootstrap_jobs_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bootstrap_sources` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `sourceUrl` VARCHAR(191) NULL,
    `sourceContent` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bootstrap_reports` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `oclLevel` VARCHAR(191) NOT NULL,
    `coverage` DOUBLE NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `risk` VARCHAR(191) NOT NULL,
    `evidence` JSON NOT NULL,
    `recommendation` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flow_irs` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `flowCode` VARCHAR(191) NOT NULL,
    `flowName` VARCHAR(191) NOT NULL,
    `flowCategory` VARCHAR(191) NULL,
    `entryUrl` VARCHAR(191) NULL,
    `submitUrl` VARCHAR(191) NULL,
    `queryUrl` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `flow_irs_bootstrapJobId_flowCode_key`(`bootstrapJobId`, `flowCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `field_irs` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `flowCode` VARCHAR(191) NOT NULL,
    `fieldKey` VARCHAR(191) NOT NULL,
    `fieldLabel` VARCHAR(191) NOT NULL,
    `fieldType` VARCHAR(191) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `defaultValue` VARCHAR(191) NULL,
    `options` JSON NULL,
    `validation` JSON NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `field_irs_bootstrapJobId_flowCode_fieldKey_key`(`bootstrapJobId`, `flowCode`, `fieldKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rule_irs` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `flowCode` VARCHAR(191) NOT NULL,
    `ruleType` VARCHAR(191) NOT NULL,
    `ruleExpression` TEXT NOT NULL,
    `errorLevel` VARCHAR(191) NOT NULL,
    `errorMessage` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permission_irs` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `flowCode` VARCHAR(191) NOT NULL,
    `permissionType` VARCHAR(191) NOT NULL,
    `permissionRule` TEXT NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `adapter_builds` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `adapterType` VARCHAR(191) NOT NULL,
    `generatedCode` TEXT NOT NULL,
    `buildStatus` VARCHAR(191) NOT NULL,
    `buildLog` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `replay_cases` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `flowCode` VARCHAR(191) NOT NULL,
    `testData` JSON NOT NULL,
    `expectedResult` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `replay_results` (
    `id` VARCHAR(191) NOT NULL,
    `replayCaseId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `actualResult` JSON NULL,
    `errorMessage` TEXT NULL,
    `executedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drift_events` (
    `id` VARCHAR(191) NOT NULL,
    `bootstrapJobId` VARCHAR(191) NOT NULL,
    `driftType` VARCHAR(191) NOT NULL,
    `driftDetails` JSON NOT NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `process_steps` (
    `id` VARCHAR(191) NOT NULL,
    `flowCode` VARCHAR(191) NOT NULL,
    `stepOrder` INTEGER NOT NULL,
    `stepName` VARCHAR(191) NOT NULL,
    `stepType` VARCHAR(191) NOT NULL,
    `stepConfig` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `process_steps_flowCode_stepOrder_key`(`flowCode`, `stepOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ui_action_graphs` (
    `id` VARCHAR(191) NOT NULL,
    `flowCode` VARCHAR(191) NOT NULL,
    `actionType` VARCHAR(191) NOT NULL,
    `selector` VARCHAR(191) NOT NULL,
    `actionValue` VARCHAR(191) NULL,
    `actionOrder` INTEGER NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `connectors` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `oaType` VARCHAR(191) NOT NULL,
    `oaVendor` VARCHAR(191) NULL,
    `oaVersion` VARCHAR(191) NULL,
    `baseUrl` VARCHAR(191) NOT NULL,
    `authType` VARCHAR(191) NOT NULL,
    `authConfig` JSON NOT NULL,
    `healthCheckUrl` VARCHAR(191) NULL,
    `oclLevel` VARCHAR(191) NOT NULL,
    `falLevel` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `lastHealthCheck` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `connectors_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `process_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `processCode` VARCHAR(191) NOT NULL,
    `processName` VARCHAR(191) NOT NULL,
    `processCategory` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `falLevel` VARCHAR(191) NOT NULL,
    `schema` JSON NOT NULL,
    `rules` JSON NULL,
    `permissions` JSON NULL,
    `uiHints` JSON NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `process_templates_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `process_templates_tenantId_processCode_version_key`(`tenantId`, `processCode`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `parse_tasks` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `sourceType` VARCHAR(191) NOT NULL,
    `sourceUrl` VARCHAR(191) NULL,
    `sourceData` JSON NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `result` JSON NULL,
    `errorMsg` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permission_policies` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `processCode` VARCHAR(191) NOT NULL,
    `policyType` VARCHAR(191) NOT NULL,
    `policyRule` JSON NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `permission_policies_tenantId_processCode_idx`(`tenantId`, `processCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `chat_sessions_tenantId_userId_idx`(`tenantId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `chat_messages_sessionId_idx`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `process_drafts` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `formData` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'editing',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `process_drafts_tenantId_userId_idx`(`tenantId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `submissions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `draftId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `formData` JSON NOT NULL,
    `oaSubmissionId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `submitResult` JSON NULL,
    `errorMsg` TEXT NULL,
    `submittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `submissions_tenantId_userId_idx`(`tenantId`, `userId`),
    INDEX `submissions_tenantId_oaSubmissionId_idx`(`tenantId`, `oaSubmissionId`),
    UNIQUE INDEX `submissions_tenantId_idempotencyKey_key`(`tenantId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `submission_statuses` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `statusDetail` JSON NULL,
    `queriedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `submission_statuses_submissionId_idx`(`submissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `traceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `resource` VARCHAR(191) NULL,
    `result` VARCHAR(191) NOT NULL,
    `details` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_tenantId_traceId_idx`(`tenantId`, `traceId`),
    INDEX `audit_logs_tenantId_userId_idx`(`tenantId`, `userId`),
    INDEX `audit_logs_tenantId_action_idx`(`tenantId`, `action`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mcp_tools` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `connectorId` VARCHAR(191) NOT NULL,
    `toolName` VARCHAR(191) NOT NULL,
    `toolDescription` TEXT NOT NULL,
    `toolSchema` JSON NOT NULL,
    `apiEndpoint` VARCHAR(191) NOT NULL,
    `httpMethod` VARCHAR(191) NOT NULL,
    `headers` JSON NULL,
    `bodyTemplate` JSON NULL,
    `paramMapping` JSON NOT NULL,
    `responseMapping` JSON NOT NULL,
    `flowCode` VARCHAR(191) NULL,
    `category` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `testInput` JSON NULL,
    `testOutput` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mcp_tools_connectorId_idx`(`connectorId`),
    INDEX `mcp_tools_flowCode_idx`(`flowCode`),
    INDEX `mcp_tools_category_idx`(`category`),
    UNIQUE INDEX `mcp_tools_connectorId_toolName_key`(`connectorId`, `toolName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bootstrap_jobs` ADD CONSTRAINT `bootstrap_jobs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bootstrap_sources` ADD CONSTRAINT `bootstrap_sources_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bootstrap_reports` ADD CONSTRAINT `bootstrap_reports_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flow_irs` ADD CONSTRAINT `flow_irs_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_irs` ADD CONSTRAINT `field_irs_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rule_irs` ADD CONSTRAINT `rule_irs_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `permission_irs` ADD CONSTRAINT `permission_irs_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `adapter_builds` ADD CONSTRAINT `adapter_builds_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replay_cases` ADD CONSTRAINT `replay_cases_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replay_results` ADD CONSTRAINT `replay_results_replayCaseId_fkey` FOREIGN KEY (`replayCaseId`) REFERENCES `replay_cases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drift_events` ADD CONSTRAINT `drift_events_bootstrapJobId_fkey` FOREIGN KEY (`bootstrapJobId`) REFERENCES `bootstrap_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `connectors` ADD CONSTRAINT `connectors_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_templates` ADD CONSTRAINT `process_templates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_templates` ADD CONSTRAINT `process_templates_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `parse_tasks` ADD CONSTRAINT `parse_tasks_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `permission_policies` ADD CONSTRAINT `permission_policies_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_sessions` ADD CONSTRAINT `chat_sessions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_sessions` ADD CONSTRAINT `chat_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_drafts` ADD CONSTRAINT `process_drafts_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_drafts` ADD CONSTRAINT `process_drafts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `process_drafts` ADD CONSTRAINT `process_drafts_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `process_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submission_statuses` ADD CONSTRAINT `submission_statuses_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mcp_tools` ADD CONSTRAINT `mcp_tools_connectorId_fkey` FOREIGN KEY (`connectorId`) REFERENCES `connectors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mcp_tools` ADD CONSTRAINT `mcp_tools_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
