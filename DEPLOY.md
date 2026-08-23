# Colocar o RS Pratas no ar

Dois caminhos, para dois objetivos diferentes. Se a apresentação é hoje, use o
primeiro — ele não depende de nenhum serviço externo dar certo na primeira
tentativa.

---

## 1. Apresentar hoje: túnel a partir desta máquina

O sistema já roda aqui. O túnel só publica um endereço `https://` que aponta
para a sua máquina, e qualquer pessoa abre pelo celular ou pelo notebook dela.
Leva dois minutos e não hiberna.

**Limitação honesta:** enquanto seu computador estiver ligado e com os
processos rodando. Fechou o notebook, o endereço morre. É demonstração, não
hospedagem.

Deixe rodando, em três terminais:

```bash
docker compose up -d
```

```bash
pnpm --filter @rs-pratas/api dev
```

```bash
pnpm --filter @rs-pratas/web dev -- --host
```

Agora o túnel. Com Cloudflare (não precisa de conta):

```bash
npx cloudflared tunnel --url http://localhost:5173
```

Ele imprime um endereço `https://algo-aleatorio.trycloudflare.com`. Falta uma
coisa: a tela precisa alcançar a API, que também está na sua máquina. Abra um
quarto terminal e exponha a API:

```bash
npx cloudflared tunnel --url http://localhost:3000
```

Com os dois endereços em mãos, aponte um para o outro. No `apps/web/.env`:

```
VITE_API_URL=https://endereco-da-api.trycloudflare.com
```

E no `apps/api/.env`, autorize a origem da tela:

```
CORS_ALLOWED_ORIGINS=https://endereco-da-tela.trycloudflare.com
```

Reinicie os dois `dev` e pronto. Se pular o `CORS_ALLOWED_ORIGINS`, a tela
abre mas nenhuma requisição funciona — o navegador bloqueia antes de sair.

---

## 2. Hospedagem gratuita para testes ao longo dos dias

Três serviços, cada um com plano gratuito. Confira os limites atuais antes de
confiar em qualquer um deles para algo sério — planos gratuitos mudam.

| Peça | Serviço | O que observar |
|---|---|---|
| Banco (Postgres) | **Neon** | Plano gratuito generoso; permite criar roles, que é o que este sistema exige |
| API | **Render** (`render.yaml` na raiz) | Hiberna após alguns minutos parado; o primeiro acesso depois disso demora ~1 min |
| Tela | **Render static**, Vercel ou Cloudflare Pages | Sem hibernação |
| Redis | **Upstash** | Opcional para testes — veja abaixo |

### Passo a passo

**1. Banco no Neon.** Crie o projeto, copie a string de conexão e rode uma vez,
no console SQL do próprio Neon, o arquivo [`scripts/setup-roles-managed.sql`](scripts/setup-roles-managed.sql)
— trocando as duas senhas antes.

Isso cria `app_owner` e `app_rw`. Monte as duas URLs trocando o usuário e a
senha na string que o Neon deu:

```
DATABASE_MIGRATE_URL=postgresql://app_owner:SENHA@...neon.tech/neondb?sslmode=require
DATABASE_URL=postgresql://app_rw:SENHA@...neon.tech/neondb?sslmode=require
```

As duas roles não são preciosismo: a API roda com a `app_rw`, que **não tem
permissão de alterar nem apagar** a auditoria e o ponto. Se as duas fossem a
mesma, a trava de imutabilidade não protegeria nada.

**2. Redis.** Crie um banco gratuito no Upstash e use a URL `rediss://`. O
sistema tolera Redis fora do ar (cai direto no banco), mas a variável
`REDIS_URL` é obrigatória para o processo subir.

**3. API e tela no Render.** Em *New → Blueprint*, aponte para este
repositório: ele lê o `render.yaml`. Preencha os segredos marcados como
`sync: false`:

- `DATABASE_URL`, `DATABASE_MIGRATE_URL`, `REDIS_URL`
- `CORS_ALLOWED_ORIGINS` — a URL da tela, depois que ela existir
- `VITE_API_URL` (no serviço da tela) — a URL da API

O `JWT_ACCESS_SECRET` e o `TOTP_ENCRYPTION_KEY` o Render gera sozinho.

**Ordem importa:** a tela precisa da URL da API no momento do BUILD, porque o
Vite embute o valor no pacote. Suba a API primeiro, pegue a URL, preencha a
variável e só então faça o deploy da tela — ou refaça o deploy dela depois.

**4. Dados de demonstração.** Com a API no ar, popule o banco a partir da sua
máquina, apontando para o banco remoto:

```bash
cd apps/api && DATABASE_URL="<url_do_app_rw>" pnpm tsx prisma/demo-seed.ts
```

O `demo-seed` cria três lojas com estoque, clientes, vendas e as três contas de
teste. Ele **se recusa a rodar com `NODE_ENV=production`** — é proposital, para
não haver o dia em que alguém popula o banco da loja com dados falsos.

---

## Antes de virar o sistema da loja de verdade

Nada disto está pronto para operar a joalheria, e a diferença não é pequena:

- **Backup.** Não existe rotina. Um banco de teste que se perde é um
  aborrecimento; o banco da loja é o histórico fiscal dela.
- **Hibernação.** No plano gratuito, a vendedora esperaria um minuto na
  primeira venda do dia.
- **E-mail.** Sem `SMTP_URL`, senha e matrícula só aparecem na tela — não são
  enviadas.
- **Domínio próprio e HTTPS estável**, em vez de um endereço aleatório.

Nenhum desses é código que falta escrever: são decisões de custo mensal que
pertencem ao dono.
