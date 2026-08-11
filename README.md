# RS Pratas

ERP e PDV para a RS Pratas — joias em prata 925. Multiloja, tablets Android em
modo quiosque, ponto eletrônico oficial, auditoria imutável e RBAC granular.

## Estrutura

- `apps/api` — Fastify + Prisma + PostgreSQL
- `apps/web` — React + Vite + Capacitor (web, desktop e tablet Android)
- `packages/shared` — schemas Zod, catálogo de permissões e tipos compartilhados
- `packages/config` — tsconfig base

## Desenvolvimento

Pré-requisitos: Node 20+, pnpm 10+, Docker.

```bash
docker compose up -d
```

O compose sobe Postgres na porta **5434** e Redis na **6380** — fora das portas
padrão, para não colidir com outros bancos locais.

Criar as roles do banco (uma vez):

```bash
docker exec -i rs-pratas-fase1-postgres psql -U postgres -d rs_pratas_fase1 -v ON_ERROR_STOP=1 < scripts/setup-roles.sql
```

Depois:

```bash
pnpm install
cp apps/api/.env.example apps/api/.env   # preencher os valores
pnpm --filter @rs-pratas/api prisma:deploy
pnpm --filter @rs-pratas/api prisma:seed
pnpm dev
```

O seed imprime a matrícula e a senha temporária do Dono **uma única vez**.

## Comandos

```bash
pnpm lint        # eslint
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
pnpm build       # build de todos os pacotes
```

## Perfis de acesso

| Perfil | Alcance |
|---|---|
| `VENDEDOR` | Opera PDV e caixa da própria loja |
| `GERENTE` | Tudo do vendedor + gestão da loja. Não cria usuários nem lojas |
| `DONO` | Acesso completo. **2FA obrigatório** |
| `DESENVOLVEDOR` | Vê tudo, **sem valores monetários** e **sem escrita** |

## Como o acesso é entregue

O Dono cadastra o funcionário informando nome, e-mail e lojas. O sistema gera a
matrícula (`RS` + 6 dígitos) e uma senha temporária, e envia as duas por e-mail.
No primeiro acesso o funcionário cria a própria senha e um PIN — só então a
conta é ativada.

No tablet da loja, o login é matrícula + PIN. O PIN nunca vale sozinho: exige um
tablet previamente pareado e ativo.

## Decisões que valem conhecer

- **Auditoria e ponto são append-only no banco**, não só na aplicação: trigger
  mais `REVOKE` de UPDATE/DELETE. Nem o dono reescreve histórico. Correção é
  sempre um evento novo apontando para o original.
- **Nenhuma marcação de ponto é recusada** (princípio do REP-P). Faltando
  justificativa, o registro entra com pendência.
- **Acesso a recurso de outra loja responde 404, não 403** — um 403 confirmaria
  que o ID existe.
- **Refresh token rotaciona a cada uso.** Reapresentar um token já rotacionado é
  tratado como roubo e derruba a sessão inteira.
- **O frontend nunca decide permissão.** Guardas de rota são conveniência de
  navegação; toda autorização real é do backend.

## Documentação

- [Modo quiosque no Android](docs/quiosque-android.md) — o que o app faz e o que
  ainda depende de configuração nativa.

## Estado

**Fase 1 concluída**: banco, autenticação, RBAC, multiloja, dispositivos,
auditoria imutável, ponto oficial e as telas correspondentes.

Fases seguintes: estações e terminais, produtos e estoque, PDV e caixa,
etiquetas, Nuvemshop, Mercado Pago, Rede/TEF, quiosque nativo e relatórios.

O desenho do ponto eletrônico segue os princípios do REP-P (Portaria MTP
671/2021), mas **precisa de validação jurídica e contábil antes de produção**.
