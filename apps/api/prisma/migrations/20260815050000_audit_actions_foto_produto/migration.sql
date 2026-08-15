-- Acoes de auditoria da foto do produto. Migracao propria: o Postgres nao
-- permite usar um valor de enum na mesma transacao em que ele e adicionado.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PRODUCT_IMAGE_SET';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PRODUCT_IMAGE_REMOVE';
