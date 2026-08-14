-- Acoes de auditoria de etiqueta e impressao. Migracao separada porque o
-- Postgres nao permite usar um valor de enum na mesma transacao em que ele
-- e adicionado.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LABEL_TEMPLATE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LABEL_TEMPLATE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PRINT_JOB_CREATE';
