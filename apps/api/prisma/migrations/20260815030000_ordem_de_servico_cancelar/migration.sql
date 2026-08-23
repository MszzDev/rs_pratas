-- Cancelar ordem de serviço é ato próprio: a peça volta para o cliente sem o
-- conserto, e quem pergunta depois precisa achar isso na auditoria.
-- IF NOT EXISTS porque valor de enum não pode ser adicionado duas vezes.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SERVICE_ORDER_CANCEL';
