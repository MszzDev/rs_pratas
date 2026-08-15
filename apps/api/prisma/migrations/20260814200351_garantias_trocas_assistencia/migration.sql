-- CreateEnum
CREATE TYPE "ReturnType" AS ENUM ('DEVOLUCAO', 'TROCA');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('PENDENTE', 'CONCLUIDA', 'RECUSADA');

-- CreateEnum
CREATE TYPE "ServiceOrderStatus" AS ENUM ('ABERTA', 'EM_ANALISE', 'AGUARDANDO_CLIENTE', 'EM_REPARO', 'PRONTA', 'ENTREGUE', 'CANCELADA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'WARRANTY_ISSUE';
ALTER TYPE "AuditAction" ADD VALUE 'WARRANTY_CLAIM';
ALTER TYPE "AuditAction" ADD VALUE 'WARRANTY_VOID';
ALTER TYPE "AuditAction" ADD VALUE 'CERTIFICATE_ISSUE';
ALTER TYPE "AuditAction" ADD VALUE 'CERTIFICATE_REISSUE';
ALTER TYPE "AuditAction" ADD VALUE 'SALE_RETURN';
ALTER TYPE "AuditAction" ADD VALUE 'SERVICE_ORDER_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'SERVICE_ORDER_UPDATE';

-- CreateTable
CREATE TABLE "warranties" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "terms" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claims" (
    "id" TEXT NOT NULL,
    "warrantyId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "approved" BOOLEAN,
    "decisionReason" TEXT,
    "serviceOrderId" TEXT,
    "openedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleItemId" TEXT,
    "code" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSku" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "weightGrams" DECIMAL(10,3),
    "details" TEXT,
    "customerName" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reissueCount" INTEGER NOT NULL DEFAULT 0,
    "issuedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "originalSaleId" TEXT NOT NULL,
    "replacementSaleId" TEXT,
    "sessionId" TEXT,
    "code" TEXT NOT NULL,
    "type" "ReturnType" NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'PENDENTE',
    "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "authorizedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_items" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "saleItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "refundAmount" DECIMAL(12,2) NOT NULL,
    "returnedToStock" BOOLEAN NOT NULL DEFAULT true,
    "condition" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_orders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ServiceOrderStatus" NOT NULL DEFAULT 'ABERTA',
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "intakeCondition" TEXT NOT NULL,
    "estimatedAmount" DECIMAL(12,2),
    "finalAmount" DECIMAL(12,2),
    "underWarranty" BOOLEAN NOT NULL DEFAULT false,
    "promisedFor" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warranties_saleItemId_key" ON "warranties"("saleItemId");

-- CreateIndex
CREATE INDEX "warranties_expiresAt_idx" ON "warranties"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "warranties_companyId_code_key" ON "warranties"("companyId", "code");

-- CreateIndex
CREATE INDEX "warranty_claims_warrantyId_idx" ON "warranty_claims"("warrantyId");

-- CreateIndex
CREATE INDEX "warranty_claims_companyId_createdAt_idx" ON "warranty_claims"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_saleItemId_key" ON "certificates"("saleItemId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_companyId_code_key" ON "certificates"("companyId", "code");

-- CreateIndex
CREATE INDEX "sale_returns_originalSaleId_idx" ON "sale_returns"("originalSaleId");

-- CreateIndex
CREATE INDEX "sale_returns_storeId_createdAt_idx" ON "sale_returns"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_companyId_code_key" ON "sale_returns"("companyId", "code");

-- CreateIndex
CREATE INDEX "sale_return_items_returnId_idx" ON "sale_return_items"("returnId");

-- CreateIndex
CREATE INDEX "service_orders_storeId_status_idx" ON "service_orders"("storeId", "status");

-- CreateIndex
CREATE INDEX "service_orders_customerId_idx" ON "service_orders"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "service_orders_companyId_code_key" ON "service_orders"("companyId", "code");

-- AddForeignKey
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_warrantyId_fkey" FOREIGN KEY ("warrantyId") REFERENCES "warranties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_originalSaleId_fkey" FOREIGN KEY ("originalSaleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_saleItemId_fkey" FOREIGN KEY ("saleItemId") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Devolucao e append-only depois de concluida.
--
-- E o registro de dinheiro que saiu do caixa. Editar depois permitiria
-- "ajustar" o valor devolvido sem que a auditoria mostrasse a mudanca — que e
-- justamente o rastro que a devolucao existe para deixar.
CREATE TRIGGER sale_return_items_no_update BEFORE UPDATE ON "sale_return_items"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
CREATE TRIGGER sale_return_items_no_delete BEFORE DELETE ON "sale_return_items"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    REVOKE UPDATE, DELETE ON "sale_return_items" FROM app_rw;
  END IF;
END
$$;

ALTER TABLE "sale_return_items"
  ADD CONSTRAINT "sale_return_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "sale_return_items"
  ADD CONSTRAINT "sale_return_items_refund_nonnegative" CHECK ("refundAmount" >= 0);
ALTER TABLE "sale_returns"
  ADD CONSTRAINT "sale_returns_refund_nonnegative" CHECK ("refundAmount" >= 0);
ALTER TABLE "warranties"
  ADD CONSTRAINT "warranties_months_positive" CHECK ("months" > 0 AND "months" <= 120);
ALTER TABLE "warranties"
  ADD CONSTRAINT "warranties_period_order" CHECK ("expiresAt" > "startsAt");
