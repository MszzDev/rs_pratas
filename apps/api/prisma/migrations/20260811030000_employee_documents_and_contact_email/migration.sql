-- E-mail volta como CANAL DE CONTATO, nunca como login.
--
-- A identidade continua sendo exclusivamente a matricula. Separar identidade de
-- canal e proposital: uma caixa de e-mail comprometida nao pode virar acesso ao
-- caixa da loja. Por isso nao ha indice unico nem busca por e-mail no login.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" TEXT;

-- Documentos do funcionario (atestado, comprovante de horas).
CREATE TYPE "EmployeeDocumentType" AS ENUM ('MEDICAL_CERTIFICATE', 'HOURS_PROOF', 'ABSENCE_JUSTIFICATION', 'OTHER');
CREATE TYPE "EmployeeDocumentStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "DocumentAnalysisVerdict" AS ENUM ('LOOKS_ROUTINE', 'NEEDS_ATTENTION', 'INCONCLUSIVE');

CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "storeId" TEXT,
    "userId" TEXT NOT NULL,
    "type" "EmployeeDocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "referenceStart" TIMESTAMP(3),
    "referenceEnd" TIMESTAMP(3),
    "fileName" TEXT NOT NULL,
    "fileMimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileStorageKey" TEXT NOT NULL,
    "fileChecksum" TEXT NOT NULL,
    "status" "EmployeeDocumentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewComment" TEXT,
    "analysisVerdict" "DocumentAnalysisVerdict",
    "analysisSummary" TEXT,
    "analysisFindings" TEXT[],
    "analysisExtracted" JSONB,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_documents_companyId_status_idx" ON "employee_documents"("companyId", "status");
CREATE INDEX "employee_documents_userId_createdAt_idx" ON "employee_documents"("userId", "createdAt");
-- Reenvio do mesmo arquivo e sinal de atencao, entao o checksum precisa ser buscavel.
CREATE INDEX "employee_documents_fileChecksum_idx" ON "employee_documents"("fileChecksum");

ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
