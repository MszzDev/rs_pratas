-- Roles do banco, espelhando produção.
--
-- app_rw   : role de runtime da API. NÃO tem UPDATE/DELETE em audit_logs nem em
--            time_clock_entries (ver migração lock_immutable_tables).
-- app_owner: dona do schema, usada só por `prisma migrate deploy`.
--
-- Separar as duas é o que dá sentido à trava de imutabilidade: se a aplicação
-- rodasse com a role dona, o REVOKE não protegeria nada.

CREATE ROLE app_owner LOGIN PASSWORD 'dev_owner_pw' CREATEDB;
GRANT ALL PRIVILEGES ON DATABASE rs_pratas_fase1 TO app_owner;
GRANT ALL PRIVILEGES ON SCHEMA public TO app_owner;

CREATE ROLE app_rw LOGIN PASSWORD 'dev_rw_pw';
GRANT CONNECT ON DATABASE rs_pratas_fase1 TO app_rw;
GRANT USAGE, CREATE ON SCHEMA public TO app_rw;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
