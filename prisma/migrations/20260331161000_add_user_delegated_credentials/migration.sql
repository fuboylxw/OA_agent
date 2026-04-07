CREATE TABLE "user_delegated_credentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "metadata" JSONB,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_delegated_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_delegated_credentials_tenantId_userId_connectorId_key"
ON "user_delegated_credentials"("tenantId", "userId", "connectorId");

CREATE INDEX "user_delegated_credentials_tenantId_userId_status_idx"
ON "user_delegated_credentials"("tenantId", "userId", "status");

CREATE INDEX "user_delegated_credentials_connectorId_status_idx"
ON "user_delegated_credentials"("connectorId", "status");

ALTER TABLE "user_delegated_credentials"
ADD CONSTRAINT "user_delegated_credentials_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "user_delegated_credentials"
ADD CONSTRAINT "user_delegated_credentials_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_delegated_credentials"
ADD CONSTRAINT "user_delegated_credentials_connectorId_fkey"
FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
