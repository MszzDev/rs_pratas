-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('NUVEMSHOP', 'MERCADOPAGO', 'REDE');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DESCONECTADA', 'CONECTADA', 'ERRO');

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DESCONECTADA',
    "externalAccountId" TEXT,
    "credentialsEncrypted" TEXT,
    "storeId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integrations_companyId_provider_key" ON "integrations"("companyId", "provider");

-- CreateIndex
CREATE INDEX "integration_events_companyId_createdAt_idx" ON "integration_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "integration_events_integrationId_processedAt_idx" ON "integration_events"("integrationId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_events_integrationId_externalId_key" ON "integration_events"("integrationId", "externalId");

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

