-- Quando os PEDIDOS do site foram lidos pela ultima vez.
--
-- Separado de `lastSyncAt`, que e a ida: o estoque que o sistema publica. Sao
-- dois sentidos independentes, e juntar os dois num carimbo so faria uma
-- sincronia bem-sucedida esconder a outra que nunca rodou.

ALTER TABLE "integrations" ADD COLUMN "lastOrderSyncAt" TIMESTAMP(3);
