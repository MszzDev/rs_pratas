-- Roles do banco em serviço gerenciado (Neon, Supabase, Render, Railway).
--
-- Rode este arquivo UMA VEZ, conectado com o usuário que o provedor entregou.
-- Ele cria as duas roles que dão sentido à trava de imutabilidade:
--
--   app_owner : dona do schema, usada só por `prisma migrate deploy`
--   app_rw    : role de runtime da API, SEM update/delete nas tabelas
--               append-only (auditoria e ponto)
--
-- Se a API rodasse com a role dona, o REVOKE das migrações não protegeria
-- nada — a separação é o mecanismo, não burocracia.
--
-- Diferença para o scripts/setup-roles.sql local: aqui não se cita o nome do
-- banco (cada provedor usa o seu) e as senhas vêm de fora. TROQUE as duas
-- senhas abaixo antes de rodar, e use as mesmas nas variáveis de ambiente.

CREATE ROLE app_owner LOGIN PASSWORD 'TROQUE_ESTA_SENHA_OWNER';
CREATE ROLE app_rw LOGIN PASSWORD 'TROQUE_ESTA_SENHA_RW';

-- O provedor às vezes não deixa dar ALL no banco; no schema é o que importa.
GRANT ALL PRIVILEGES ON SCHEMA public TO app_owner;
GRANT USAGE, CREATE ON SCHEMA public TO app_rw;

-- Em serviço gerenciado o usuário inicial costuma ser o dono do schema. Sem
-- esta linha, o app_owner cria as tabelas mas o app_rw não enxerga nada.
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;

-- Alguns provedores exigem que o usuário inicial passe a fazer parte das roles
-- novas para poder administrá-las depois.
GRANT app_owner TO CURRENT_USER;
GRANT app_rw TO CURRENT_USER;
