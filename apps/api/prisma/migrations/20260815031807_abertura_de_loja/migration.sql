-- Abertura de loja.
--
-- A loja passa a ter um estado de ABERTA AGORA, separado de ter cadastro
-- ativo. Uma loja pode existir (isActive) e estar fechada (isOpen = false) —
-- é o caso de toda loja fora do horário de funcionamento.
--
-- Os valores de AuditAction que acompanham esta mudança estão numa migração
-- própria: o Postgres não permite usar um valor de enum na mesma transação em
-- que ele é adicionado, e juntar os dois deixa a migração pela metade quando
-- alguma coisa falha.

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "isOpen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "openedAt" TIMESTAMP(3),
ADD COLUMN     "openedByDeviceId" TEXT,
ADD COLUMN     "openedById" TEXT;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
