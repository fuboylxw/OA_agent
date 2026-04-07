-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "roles" JSONB NOT NULL,
    "oaUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootstrap_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "queueJobId" TEXT,
    "currentStage" TEXT,
    "stageStartedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "recoveryAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "reconcileAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "stalledReason" TEXT,
    "lastError" TEXT,
    "oaUrl" TEXT,
    "authConfig" JSONB,
    "sourceBundleUrl" TEXT,
    "openApiUrl" TEXT,
    "harFileUrl" TEXT,
    "uploadedFiles" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "bootstrap_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootstrap_sources" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceContent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bootstrap_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootstrap_reports" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "oclLevel" TEXT NOT NULL,
    "coverage" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "risk" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bootstrap_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootstrap_repair_attempts" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "flowCode" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "proposedPatch" JSONB,
    "appliedPatch" JSONB,
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bootstrap_repair_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_irs" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "flowCode" TEXT NOT NULL,
    "flowName" TEXT NOT NULL,
    "flowCategory" TEXT,
    "entryUrl" TEXT,
    "submitUrl" TEXT,
    "queryUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_irs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_irs" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "flowCode" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "options" JSONB,
    "validation" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_irs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_irs" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "flowCode" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "ruleExpression" TEXT NOT NULL,
    "errorLevel" TEXT NOT NULL,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_irs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_irs" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "flowCode" TEXT NOT NULL,
    "permissionType" TEXT NOT NULL,
    "permissionRule" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_irs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adapter_builds" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "generatedCode" TEXT NOT NULL,
    "buildStatus" TEXT NOT NULL,
    "buildLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adapter_builds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replay_cases" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "flowCode" TEXT NOT NULL,
    "testData" JSONB NOT NULL,
    "expectedResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replay_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replay_results" (
    "id" TEXT NOT NULL,
    "replayCaseId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actualResult" JSONB,
    "errorMessage" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replay_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_events" (
    "id" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "driftType" TEXT NOT NULL,
    "driftDetails" JSONB NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "drift_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_steps" (
    "id" TEXT NOT NULL,
    "flowCode" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "stepType" TEXT NOT NULL,
    "stepConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "process_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ui_action_graphs" (
    "id" TEXT NOT NULL,
    "flowCode" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "selector" TEXT NOT NULL,
    "actionValue" TEXT,
    "actionOrder" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ui_action_graphs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "oaType" TEXT NOT NULL,
    "oaVendor" TEXT,
    "oaVersion" TEXT,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL,
    "authConfig" JSONB NOT NULL,
    "healthCheckUrl" TEXT,
    "oclLevel" TEXT NOT NULL,
    "falLevel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastHealthCheck" TIMESTAMP(3),
    "syncStrategy" JSONB,
    "statusMapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_secret_refs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "secretProvider" TEXT NOT NULL,
    "secretPath" TEXT NOT NULL,
    "secretVersion" TEXT,
    "rotationStatus" TEXT NOT NULL DEFAULT 'active',
    "lastRotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_secret_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_capabilities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "supportsDiscovery" BOOLEAN NOT NULL DEFAULT false,
    "supportsSchemaSync" BOOLEAN NOT NULL DEFAULT false,
    "supportsReferenceSync" BOOLEAN NOT NULL DEFAULT false,
    "supportsStatusPull" BOOLEAN NOT NULL DEFAULT false,
    "supportsWebhook" BOOLEAN NOT NULL DEFAULT false,
    "supportsCancel" BOOLEAN NOT NULL DEFAULT false,
    "supportsUrge" BOOLEAN NOT NULL DEFAULT false,
    "supportsDelegate" BOOLEAN NOT NULL DEFAULT false,
    "supportsSupplement" BOOLEAN NOT NULL DEFAULT false,
    "supportsRealtimePerm" BOOLEAN NOT NULL DEFAULT false,
    "supportsIdempotency" BOOLEAN NOT NULL DEFAULT false,
    "syncModes" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remote_processes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "remoteProcessId" TEXT NOT NULL,
    "remoteProcessCode" TEXT,
    "remoteProcessName" TEXT NOT NULL,
    "processCategory" TEXT,
    "sourceVersion" TEXT,
    "sourceHash" TEXT NOT NULL,
    "latestTemplateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSchemaSyncAt" TIMESTAMP(3),
    "lastDriftCheckAt" TIMESTAMP(3),

    CONSTRAINT "remote_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_datasets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "datasetCode" TEXT NOT NULL,
    "datasetName" TEXT NOT NULL,
    "datasetType" TEXT NOT NULL,
    "syncMode" TEXT NOT NULL,
    "sourceHash" TEXT,
    "sourceVersion" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reference_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_items" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "remoteItemId" TEXT,
    "itemKey" TEXT NOT NULL,
    "itemLabel" TEXT NOT NULL,
    "itemValue" TEXT,
    "parentKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reference_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "remoteProcessId" TEXT,
    "processCode" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "processCategory" TEXT,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "falLevel" TEXT NOT NULL,
    "sourceHash" TEXT,
    "sourceVersion" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'approved',
    "changeSummary" JSONB,
    "supersedesId" TEXT,
    "schema" JSONB NOT NULL,
    "rules" JSONB,
    "permissions" JSONB,
    "uiHints" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parse_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceData" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "parse_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processCode" TEXT NOT NULL,
    "policyType" TEXT NOT NULL,
    "policyRule" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permission_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_drafts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sessionId" TEXT,
    "formData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'editing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "draftId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "formData" JSONB NOT NULL,
    "oaSubmissionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submitResult" JSONB,
    "errorMsg" TEXT,
    "submittedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncFailCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_statuses" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusDetail" JSONB,
    "queriedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventSource" TEXT NOT NULL,
    "remoteEventId" TEXT,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "storageType" TEXT NOT NULL DEFAULT 'local',
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "extension" TEXT,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "previewStatus" TEXT NOT NULL DEFAULT 'none',
    "previewKey" TEXT,
    "previewError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attachment_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment_bindings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sessionId" TEXT,
    "draftId" TEXT,
    "submissionId" TEXT,
    "fieldKey" TEXT,
    "bindScope" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "result" TEXT NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_tools" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "toolDescription" TEXT NOT NULL,
    "toolSchema" JSONB NOT NULL,
    "apiEndpoint" TEXT NOT NULL,
    "httpMethod" TEXT NOT NULL,
    "headers" JSONB,
    "bodyTemplate" JSONB,
    "paramMapping" JSONB NOT NULL,
    "responseMapping" JSONB NOT NULL,
    "flowCode" TEXT,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "testInput" JSONB,
    "testOutput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_upload_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "sourceName" TEXT,
    "sourceHash" TEXT NOT NULL,
    "sourceContent" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "oaUrl" TEXT,
    "authConfig" JSONB,
    "autoValidate" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerateMcp" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentAttemptNo" INTEGER NOT NULL DEFAULT 0,
    "finalDecision" TEXT,
    "finalErrorType" TEXT,
    "finalErrorMessage" TEXT,
    "acceptedContent" TEXT,
    "acceptedContentHash" TEXT,
    "acceptedEndpointCount" INTEGER,
    "acceptedWorkflowCount" INTEGER,
    "acceptedValidationScore" DOUBLE PRECISION,
    "uploadResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "api_upload_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_upload_attempts" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "inputContent" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputContent" TEXT,
    "outputHash" TEXT,
    "diagnostics" JSONB,
    "repairActions" JSONB,
    "parseSuccess" BOOLEAN NOT NULL DEFAULT false,
    "endpointCount" INTEGER NOT NULL DEFAULT 0,
    "workflowCount" INTEGER NOT NULL DEFAULT 0,
    "validationScore" DOUBLE PRECISION,
    "decision" TEXT NOT NULL,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_upload_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parse_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bootstrapJobId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentUrl" TEXT,
    "documentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "parseOptions" JSONB NOT NULL,
    "parseResult" JSONB,
    "parseMetadata" JSONB,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "parse_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_processes" (
    "id" TEXT NOT NULL,
    "parseJobId" TEXT NOT NULL,
    "processCode" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "processCategory" TEXT NOT NULL,
    "description" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "endpoints" JSONB NOT NULL,
    "fields" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "publishedTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extracted_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "syncDomain" TEXT NOT NULL,
    "cursorType" TEXT NOT NULL,
    "cursorValue" TEXT,
    "lastVersion" TEXT,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "syncDomain" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scope" JSONB,
    "cursorSnapshot" JSONB,
    "result" JSONB,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_inboxes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "eventType" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "headers" JSONB,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processStatus" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,

    CONSTRAINT "webhook_inboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "submissionId" TEXT,
    "syncType" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "statusBefore" TEXT,
    "statusAfter" TEXT,
    "remoteRaw" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_username_key" ON "users"("tenantId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "bootstrap_jobs_tenantId_status_idx" ON "bootstrap_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "bootstrap_jobs_connectorId_idx" ON "bootstrap_jobs"("connectorId");

-- CreateIndex
CREATE INDEX "bootstrap_jobs_queueJobId_idx" ON "bootstrap_jobs"("queueJobId");

-- CreateIndex
CREATE INDEX "bootstrap_jobs_status_lastHeartbeatAt_idx" ON "bootstrap_jobs"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "bootstrap_repair_attempts_bootstrapJobId_flowCode_idx" ON "bootstrap_repair_attempts"("bootstrapJobId", "flowCode");

-- CreateIndex
CREATE UNIQUE INDEX "bootstrap_repair_attempts_bootstrapJobId_flowCode_attemptNo_key" ON "bootstrap_repair_attempts"("bootstrapJobId", "flowCode", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "flow_irs_bootstrapJobId_flowCode_key" ON "flow_irs"("bootstrapJobId", "flowCode");

-- CreateIndex
CREATE UNIQUE INDEX "field_irs_bootstrapJobId_flowCode_fieldKey_key" ON "field_irs"("bootstrapJobId", "flowCode", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "process_steps_flowCode_stepOrder_key" ON "process_steps"("flowCode", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "connectors_tenantId_name_key" ON "connectors"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "connector_secret_refs_connectorId_key" ON "connector_secret_refs"("connectorId");

-- CreateIndex
CREATE INDEX "connector_secret_refs_tenantId_idx" ON "connector_secret_refs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "connector_capabilities_connectorId_key" ON "connector_capabilities"("connectorId");

-- CreateIndex
CREATE INDEX "connector_capabilities_tenantId_idx" ON "connector_capabilities"("tenantId");

-- CreateIndex
CREATE INDEX "remote_processes_tenantId_connectorId_idx" ON "remote_processes"("tenantId", "connectorId");

-- CreateIndex
CREATE INDEX "remote_processes_sourceHash_idx" ON "remote_processes"("sourceHash");

-- CreateIndex
CREATE UNIQUE INDEX "remote_processes_connectorId_remoteProcessId_key" ON "remote_processes"("connectorId", "remoteProcessId");

-- CreateIndex
CREATE INDEX "reference_datasets_tenantId_datasetType_idx" ON "reference_datasets"("tenantId", "datasetType");

-- CreateIndex
CREATE UNIQUE INDEX "reference_datasets_connectorId_datasetCode_key" ON "reference_datasets"("connectorId", "datasetCode");

-- CreateIndex
CREATE INDEX "reference_items_datasetId_itemKey_idx" ON "reference_items"("datasetId", "itemKey");

-- CreateIndex
CREATE INDEX "reference_items_datasetId_remoteItemId_idx" ON "reference_items"("datasetId", "remoteItemId");

-- CreateIndex
CREATE INDEX "process_templates_tenantId_status_idx" ON "process_templates"("tenantId", "status");

-- CreateIndex
CREATE INDEX "process_templates_connectorId_remoteProcessId_version_idx" ON "process_templates"("connectorId", "remoteProcessId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "process_templates_connectorId_processCode_version_key" ON "process_templates"("connectorId", "processCode", "version");

-- CreateIndex
CREATE INDEX "permission_policies_tenantId_processCode_idx" ON "permission_policies"("tenantId", "processCode");

-- CreateIndex
CREATE INDEX "chat_sessions_tenantId_userId_idx" ON "chat_sessions"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "chat_messages_sessionId_idx" ON "chat_messages"("sessionId");

-- CreateIndex
CREATE INDEX "chat_messages_sessionId_createdAt_idx" ON "chat_messages"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "process_drafts_tenantId_userId_idx" ON "process_drafts"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "submissions_tenantId_userId_idx" ON "submissions"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "submissions_tenantId_oaSubmissionId_idx" ON "submissions"("tenantId", "oaSubmissionId");

-- CreateIndex
CREATE INDEX "submissions_tenantId_templateId_status_idx" ON "submissions"("tenantId", "templateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_tenantId_idempotencyKey_key" ON "submissions"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "submission_statuses_submissionId_idx" ON "submission_statuses"("submissionId");

-- CreateIndex
CREATE INDEX "submission_events_tenantId_status_idx" ON "submission_events"("tenantId", "status");

-- CreateIndex
CREATE INDEX "submission_events_submissionId_eventTime_idx" ON "submission_events"("submissionId", "eventTime");

-- CreateIndex
CREATE UNIQUE INDEX "submission_events_submissionId_eventSource_remoteEventId_key" ON "submission_events"("submissionId", "eventSource", "remoteEventId");

-- CreateIndex
CREATE INDEX "attachment_assets_tenantId_uploaderId_idx" ON "attachment_assets"("tenantId", "uploaderId");

-- CreateIndex
CREATE INDEX "attachment_assets_tenantId_status_idx" ON "attachment_assets"("tenantId", "status");

-- CreateIndex
CREATE INDEX "attachment_bindings_tenantId_assetId_idx" ON "attachment_bindings"("tenantId", "assetId");

-- CreateIndex
CREATE INDEX "attachment_bindings_tenantId_sessionId_idx" ON "attachment_bindings"("tenantId", "sessionId");

-- CreateIndex
CREATE INDEX "attachment_bindings_tenantId_draftId_idx" ON "attachment_bindings"("tenantId", "draftId");

-- CreateIndex
CREATE INDEX "attachment_bindings_tenantId_submissionId_idx" ON "attachment_bindings"("tenantId", "submissionId");

-- CreateIndex
CREATE INDEX "attachment_bindings_tenantId_fieldKey_idx" ON "attachment_bindings"("tenantId", "fieldKey");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_traceId_idx" ON "audit_logs"("tenantId", "traceId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_userId_idx" ON "audit_logs"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_action_idx" ON "audit_logs"("tenantId", "action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "mcp_tools_connectorId_idx" ON "mcp_tools"("connectorId");

-- CreateIndex
CREATE INDEX "mcp_tools_flowCode_idx" ON "mcp_tools"("flowCode");

-- CreateIndex
CREATE INDEX "mcp_tools_category_idx" ON "mcp_tools"("category");

-- CreateIndex
CREATE INDEX "mcp_tools_connectorId_category_enabled_idx" ON "mcp_tools"("connectorId", "category", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tools_connectorId_toolName_key" ON "mcp_tools"("connectorId", "toolName");

-- CreateIndex
CREATE INDEX "api_upload_jobs_tenantId_connectorId_idx" ON "api_upload_jobs"("tenantId", "connectorId");

-- CreateIndex
CREATE INDEX "api_upload_jobs_tenantId_status_idx" ON "api_upload_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "api_upload_attempts_jobId_decision_idx" ON "api_upload_attempts"("jobId", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "api_upload_attempts_jobId_attemptNo_key" ON "api_upload_attempts"("jobId", "attemptNo");

-- CreateIndex
CREATE INDEX "parse_jobs_tenantId_idx" ON "parse_jobs"("tenantId");

-- CreateIndex
CREATE INDEX "parse_jobs_bootstrapJobId_idx" ON "parse_jobs"("bootstrapJobId");

-- CreateIndex
CREATE INDEX "parse_jobs_status_idx" ON "parse_jobs"("status");

-- CreateIndex
CREATE INDEX "parse_jobs_documentHash_idx" ON "parse_jobs"("documentHash");

-- CreateIndex
CREATE INDEX "extracted_processes_parseJobId_idx" ON "extracted_processes"("parseJobId");

-- CreateIndex
CREATE INDEX "extracted_processes_processCode_idx" ON "extracted_processes"("processCode");

-- CreateIndex
CREATE INDEX "extracted_processes_status_idx" ON "extracted_processes"("status");

-- CreateIndex
CREATE INDEX "sync_cursors_tenantId_syncDomain_idx" ON "sync_cursors"("tenantId", "syncDomain");

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursors_connectorId_syncDomain_key" ON "sync_cursors"("connectorId", "syncDomain");

-- CreateIndex
CREATE INDEX "sync_jobs_connectorId_syncDomain_status_idx" ON "sync_jobs"("connectorId", "syncDomain", "status");

-- CreateIndex
CREATE INDEX "sync_jobs_tenantId_createdAt_idx" ON "sync_jobs"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inboxes_dedupeKey_key" ON "webhook_inboxes"("dedupeKey");

-- CreateIndex
CREATE INDEX "webhook_inboxes_connectorId_processStatus_idx" ON "webhook_inboxes"("connectorId", "processStatus");

-- CreateIndex
CREATE INDEX "sync_logs_connectorId_createdAt_idx" ON "sync_logs"("connectorId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_logs_submissionId_idx" ON "sync_logs"("submissionId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_jobs" ADD CONSTRAINT "bootstrap_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_jobs" ADD CONSTRAINT "bootstrap_jobs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_sources" ADD CONSTRAINT "bootstrap_sources_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_reports" ADD CONSTRAINT "bootstrap_reports_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootstrap_repair_attempts" ADD CONSTRAINT "bootstrap_repair_attempts_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_irs" ADD CONSTRAINT "flow_irs_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_irs" ADD CONSTRAINT "field_irs_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_irs" ADD CONSTRAINT "rule_irs_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_irs" ADD CONSTRAINT "permission_irs_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adapter_builds" ADD CONSTRAINT "adapter_builds_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replay_cases" ADD CONSTRAINT "replay_cases_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replay_results" ADD CONSTRAINT "replay_results_replayCaseId_fkey" FOREIGN KEY ("replayCaseId") REFERENCES "replay_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_secret_refs" ADD CONSTRAINT "connector_secret_refs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_secret_refs" ADD CONSTRAINT "connector_secret_refs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_capabilities" ADD CONSTRAINT "connector_capabilities_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_capabilities" ADD CONSTRAINT "connector_capabilities_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remote_processes" ADD CONSTRAINT "remote_processes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remote_processes" ADD CONSTRAINT "remote_processes_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_datasets" ADD CONSTRAINT "reference_datasets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_datasets" ADD CONSTRAINT "reference_datasets_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_items" ADD CONSTRAINT "reference_items_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "reference_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_remoteProcessId_fkey" FOREIGN KEY ("remoteProcessId") REFERENCES "remote_processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_templates" ADD CONSTRAINT "process_templates_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "process_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parse_tasks" ADD CONSTRAINT "parse_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_policies" ADD CONSTRAINT "permission_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_drafts" ADD CONSTRAINT "process_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_drafts" ADD CONSTRAINT "process_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_drafts" ADD CONSTRAINT "process_drafts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "process_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_statuses" ADD CONSTRAINT "submission_statuses_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_bindings" ADD CONSTRAINT "attachment_bindings_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "attachment_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_bindings" ADD CONSTRAINT "attachment_bindings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_bindings" ADD CONSTRAINT "attachment_bindings_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "process_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment_bindings" ADD CONSTRAINT "attachment_bindings_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_upload_jobs" ADD CONSTRAINT "api_upload_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_upload_jobs" ADD CONSTRAINT "api_upload_jobs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_upload_attempts" ADD CONSTRAINT "api_upload_attempts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "api_upload_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parse_jobs" ADD CONSTRAINT "parse_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parse_jobs" ADD CONSTRAINT "parse_jobs_bootstrapJobId_fkey" FOREIGN KEY ("bootstrapJobId") REFERENCES "bootstrap_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_processes" ADD CONSTRAINT "extracted_processes_parseJobId_fkey" FOREIGN KEY ("parseJobId") REFERENCES "parse_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inboxes" ADD CONSTRAINT "webhook_inboxes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inboxes" ADD CONSTRAINT "webhook_inboxes_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

