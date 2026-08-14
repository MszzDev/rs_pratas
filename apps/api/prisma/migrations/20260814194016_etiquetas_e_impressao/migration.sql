-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('NA_FILA', 'IMPRIMINDO', 'CONCLUIDO', 'FALHOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "PrintJobType" AS ENUM ('ETIQUETA', 'COMPROVANTE', 'FECHAMENTO_CAIXA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'LABEL_TEMPLATE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'LABEL_TEMPLATE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'PRINT_JOB_CREATE';

-- CreateTable
CREATE TABLE "label_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "widthMm" DECIMAL(6,2) NOT NULL,
    "heightMm" DECIMAL(6,2) NOT NULL,
    "isDoubleSided" BOOLEAN NOT NULL DEFAULT true,
    "showProductName" BOOLEAN NOT NULL DEFAULT true,
    "showSku" BOOLEAN NOT NULL DEFAULT true,
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "showWeight" BOOLEAN NOT NULL DEFAULT false,
    "showSize" BOOLEAN NOT NULL DEFAULT true,
    "showBarcode" BOOLEAN NOT NULL DEFAULT true,
    "offsetXMm" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "offsetYMm" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "fontScale" DECIMAL(4,2) NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "label_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deviceId" TEXT,
    "type" "PrintJobType" NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'NA_FILA',
    "templateId" TEXT,
    "payload" JSONB NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "label_templates_companyId_code_key" ON "label_templates"("companyId", "code");

-- CreateIndex
CREATE INDEX "print_jobs_storeId_status_createdAt_idx" ON "print_jobs"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "print_jobs_deviceId_status_idx" ON "print_jobs"("deviceId", "status");

-- AddForeignKey
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "label_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Um modelo padrao por empresa, garantido pelo banco.
--
-- Dois padroes fariam a etiqueta sair com dimensao diferente conforme a ordem
-- da consulta — o tipo de bug que so aparece quando um rolo inteiro ja foi
-- impresso torto.
CREATE UNIQUE INDEX "label_templates_one_default_per_company"
  ON "label_templates"("companyId")
  WHERE "isDefault" = true AND "deletedAt" IS NULL;

ALTER TABLE "print_jobs"
  ADD CONSTRAINT "print_jobs_copies_positive" CHECK ("copies" > 0 AND "copies" <= 100);
ALTER TABLE "label_templates"
  ADD CONSTRAINT "label_templates_dimensions_positive"
  CHECK ("widthMm" > 0 AND "heightMm" > 0);
