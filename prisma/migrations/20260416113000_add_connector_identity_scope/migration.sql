ALTER TABLE "connectors"
ADD COLUMN "identityScope" TEXT NOT NULL DEFAULT 'both';

ALTER TABLE "bootstrap_jobs"
ADD COLUMN "identityScope" TEXT NOT NULL DEFAULT 'both';
