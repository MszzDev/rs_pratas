-- CreateEnum
CREATE TYPE "PieceRequestStatus" AS ENUM ('ABERTA', 'PROCURANDO', 'ENCONTRADA', 'AVISADO', 'CONCLUIDA', 'CANCELADA');

-- CreateTable
CREATE TABLE "piece_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PieceRequestStatus" NOT NULL DEFAULT 'ABERTA',
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "productId" TEXT,
    "size" TEXT,
    "budgetAmount" DECIMAL(12,2),
    "notes" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "convertedSaleId" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "piece_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "piece_requests_storeId_status_idx" ON "piece_requests"("storeId", "status");

-- CreateIndex
CREATE INDEX "piece_requests_customerPhone_idx" ON "piece_requests"("customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "piece_requests_companyId_code_key" ON "piece_requests"("companyId", "code");

-- AddForeignKey
ALTER TABLE "piece_requests" ADD CONSTRAINT "piece_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_requests" ADD CONSTRAINT "piece_requests_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_requests" ADD CONSTRAINT "piece_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_requests" ADD CONSTRAINT "piece_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

