-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cpf" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_company_cpf_key" ON "users"("companyId", "cpf");

