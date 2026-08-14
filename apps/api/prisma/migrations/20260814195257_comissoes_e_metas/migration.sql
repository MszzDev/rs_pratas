-- CreateEnum
CREATE TYPE "CommissionBasis" AS ENUM ('FATURAMENTO', 'MARGEM');

-- CreateEnum
CREATE TYPE "GoalPeriod" AS ENUM ('DIARIA', 'SEMANAL', 'MENSAL');

-- CreateEnum
CREATE TYPE "GoalScope" AS ENUM ('LOJA', 'VENDEDOR');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_RULE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'COMMISSION_RULE_END';
ALTER TYPE "AuditAction" ADD VALUE 'GOAL_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'GOAL_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_VIEW';

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "basis" "CommissionBasis" NOT NULL DEFAULT 'FATURAMENTO',
    "percent" DECIMAL(6,3) NOT NULL,
    "minimumSalesAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "scope" "GoalScope" NOT NULL,
    "userId" TEXT,
    "period" "GoalPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "targetAmount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_rules_companyId_isActive_idx" ON "commission_rules"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "commission_rules_storeId_userId_idx" ON "commission_rules"("storeId", "userId");

-- CreateIndex
CREATE INDEX "goals_companyId_periodStart_idx" ON "goals"("companyId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "goals_storeId_scope_userId_periodStart_key" ON "goals"("storeId", "scope", "userId", "periodStart");

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Percentual de comissao dentro de limites que fazem sentido.
ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_percent_range"
  CHECK ("percent" >= 0 AND "percent" <= 100);
ALTER TABLE "goals"
  ADD CONSTRAINT "goals_target_positive" CHECK ("targetAmount" > 0);
ALTER TABLE "goals"
  ADD CONSTRAINT "goals_period_order" CHECK ("periodEnd" > "periodStart");

-- Uma regra de comissao vigente por abrangencia.
--
-- Duas regras ativas para o mesmo vendedor no mesmo periodo tornariam a
-- comissao dependente da ordem da consulta — e comissao calculada de dois
-- jeitos diferentes vira discussao de folha de pagamento.
CREATE UNIQUE INDEX "commission_rules_one_active_per_scope"
  ON "commission_rules"("companyId", COALESCE("storeId", ''), COALESCE("userId", ''))
  WHERE "isActive" = true AND "effectiveTo" IS NULL;
