-- CreateTable
CREATE TABLE "auth_bindings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "userId" TEXT,
    "bindingName" TEXT,
    "ownerType" TEXT NOT NULL DEFAULT 'user',
    "authType" TEXT NOT NULL,
    "authMode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastBoundAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "authBindingId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "encryptedPayload" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastValidatedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_session_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_bindings_tenantId_connectorId_status_idx" ON "auth_bindings"("tenantId", "connectorId", "status");

-- CreateIndex
CREATE INDEX "auth_bindings_tenantId_userId_status_idx" ON "auth_bindings"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "auth_bindings_connectorId_userId_isDefault_idx" ON "auth_bindings"("connectorId", "userId", "isDefault");

-- CreateIndex
CREATE INDEX "auth_session_assets_tenantId_authBindingId_status_idx" ON "auth_session_assets"("tenantId", "authBindingId", "status");

-- CreateIndex
CREATE INDEX "auth_session_assets_authBindingId_assetType_status_idx" ON "auth_session_assets"("authBindingId", "assetType", "status");

-- AddForeignKey
ALTER TABLE "auth_bindings" ADD CONSTRAINT "auth_bindings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_bindings" ADD CONSTRAINT "auth_bindings_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_bindings" ADD CONSTRAINT "auth_bindings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session_assets" ADD CONSTRAINT "auth_session_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session_assets" ADD CONSTRAINT "auth_session_assets_authBindingId_fkey" FOREIGN KEY ("authBindingId") REFERENCES "auth_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
