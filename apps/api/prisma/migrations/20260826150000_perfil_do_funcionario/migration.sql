-- O perfil de cada funcionário.
--
-- Foto e preferências de tela ficam no cadastro, e não no aparelho: o tablet
-- do balcão é compartilhado, e guardar a escolha nele faria a preferência de
-- uma vendedora valer para a colega do turno seguinte. Assim a pessoa entra em
-- qualquer tablet da rede e o sistema já está do jeito dela.
CREATE TYPE "UserTheme" AS ENUM ('CLARO', 'ESCURO', 'SISTEMA');

ALTER TABLE "users"
  ADD COLUMN "avatarStorageKey" TEXT,
  ADD COLUMN "theme" "UserTheme" NOT NULL DEFAULT 'SISTEMA',
  ADD COLUMN "fontScale" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "highContrast" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reduceMotion" BOOLEAN NOT NULL DEFAULT false;
