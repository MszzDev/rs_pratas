-- Envio de arquivo pelo celular do próprio funcionário.
--
-- O tablet do balcão está em modo quiosque, e o seletor de arquivos do Android
-- é outra tela — o confinamento não deixa abri-la. A tela de documentos
-- existia e era inútil justamente no aparelho onde a pessoa passa o dia.
--
-- Agora ela gera um QR Code no tablet, lê com o próprio celular, e envia de
-- lá. O quiosque continua lacrado.
--
-- O token não é guardado: só o hash dele. Vale minutos, serve uma vez, e está
-- preso a uma pessoa e a uma finalidade.
CREATE TYPE "UploadPurpose" AS ENUM ('DOCUMENTO', 'FOTO');

CREATE TABLE "upload_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "deviceId" TEXT,

    CONSTRAINT "upload_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "upload_links_tokenHash_key" ON "upload_links"("tokenHash");
CREATE INDEX "upload_links_userId_createdAt_idx" ON "upload_links"("userId", "createdAt");
-- Para a limpeza dos vencidos não varrer a tabela inteira.
CREATE INDEX "upload_links_expiresAt_idx" ON "upload_links"("expiresAt");

ALTER TABLE "upload_links" ADD CONSTRAINT "upload_links_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
