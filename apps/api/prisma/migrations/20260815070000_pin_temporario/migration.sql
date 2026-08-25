-- CreateEnum
CREATE TYPE "PinResetStatus" AS ENUM ('PENDENTE', 'APROVADA', 'RECUSADA');

-- CreateTable
CREATE TABLE "pin_reset_requests" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PinResetStatus" NOT NULL DEFAULT 'PENDENTE',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deviceId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "pin_reset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pin_reset_requests_companyId_status_idx" ON "pin_reset_requests"("companyId", "status");

-- CreateIndex
CREATE INDEX "pin_reset_requests_userId_requestedAt_idx" ON "pin_reset_requests"("userId", "requestedAt");

-- AddForeignKey
ALTER TABLE "pin_reset_requests" ADD CONSTRAINT "pin_reset_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

