-- Acoes de auditoria da solicitacao de peca. Migracao propria: o Postgres nao
-- permite usar um valor de enum na mesma transacao em que ele e adicionado.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PIECE_REQUEST_CREATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PIECE_REQUEST_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PIECE_REQUEST_CANCEL';
