-- Arquivos passam a morar no banco.
--
-- O disco do servidor é apagado a cada publicação da hospedagem. Foto de peça
-- e documento de funcionário iam junto, sem aviso: o cadastro continuava
-- apontando para um arquivo inexistente, e ninguém descobria até abrir a peça
-- na tela.
--
-- Aqui eles entram na cópia semanal do banco, que já é feita e já foi testada
-- restaurando de verdade.
--
-- Os arquivos ANTERIORES a esta migração não são recuperados: eles já não
-- existem em lugar nenhum. As linhas que apontam para eles ficam como estão, e
-- o download responde explicando que o arquivo precisa ser reenviado.
CREATE TABLE "stored_files" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- A chave viaja na URL de download. Única para o cadastro achar o arquivo, e
-- sorteada (uuid) para que ninguém chegue ao documento de outra pessoa
-- trocando um número.
CREATE UNIQUE INDEX "stored_files_key_key" ON "stored_files"("key");

-- Responde "o que está ocupando espaço no banco?" sem abrir arquivo nenhum.
CREATE INDEX "stored_files_scope_idx" ON "stored_files"("scope");
