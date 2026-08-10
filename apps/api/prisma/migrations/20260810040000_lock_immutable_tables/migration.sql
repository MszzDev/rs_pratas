-- Torna audit_logs e time_clock_entries append-only.
--
-- Duas travas independentes de proposito:
--
--   1. REVOKE: a role de runtime da aplicacao (app_rw) perde o privilegio de
--      UPDATE/DELETE nessas tabelas. Um bug de aplicacao nao consegue nem
--      montar a operacao.
--   2. TRIGGER: mesmo uma conexao com privilegio (um DBA, ou a role de
--      migracao) esbarra na excecao. Nem o dono do sistema reescreve historico.
--
-- Auditoria so vale como prova se ninguem puder edita-la depois do fato — o
-- registro de ponto, idem: correcao e sempre um evento NOVO apontando para o
-- original, nunca um UPDATE da linha.

CREATE OR REPLACE FUNCTION prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabela append-only: % nao e permitido em %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DROP TRIGGER IF EXISTS time_clock_entries_no_update ON time_clock_entries;
CREATE TRIGGER time_clock_entries_no_update BEFORE UPDATE ON time_clock_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

DROP TRIGGER IF EXISTS time_clock_entries_no_delete ON time_clock_entries;
CREATE TRIGGER time_clock_entries_no_delete BEFORE DELETE ON time_clock_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- A role de runtime pode inserir e ler, nunca alterar nem apagar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    REVOKE UPDATE, DELETE ON audit_logs FROM app_rw;
    REVOKE UPDATE, DELETE ON time_clock_entries FROM app_rw;
  END IF;
END
$$;
