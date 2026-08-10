# RS Pratas

ERP/PDV para a RS Pratas (joias em prata 925) — multiloja, tablets Android em modo quiosque, PDV, caixa, estoque, ponto eletrônico oficial, auditoria imutável e RBAC granular.

## Estrutura

- `apps/api` — Fastify + Prisma + PostgreSQL
- `apps/web` — React + Vite + Capacitor (web, desktop e tablet Android)
- `packages/shared` — schemas Zod, catálogo de permissões e helpers compartilhados entre `api` e `web`
- `packages/config` — tsconfig e eslint base

## Desenvolvimento

Pré-requisitos: Node 20+, pnpm 9+, Docker (Postgres + Redis locais).

```bash
pnpm install
pnpm dev
```

Variáveis de ambiente: ver `apps/api/.env.example`. Nunca commitar `.env`.

## Status

Fase 1 (fundação) em desenvolvimento: autenticação, RBAC, multiloja, auditoria imutável e ponto eletrônico oficial. Ver plano técnico em andamento para o roteiro completo de fases.
