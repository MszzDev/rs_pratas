import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { redis } from "./db/redis.js";

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "encerrando");
  // Fecha o servidor primeiro: as requisições em voo terminam antes de as
  // conexões sumirem debaixo delas.
  await app.close();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.PORT, host: "0.0.0.0" });

/**
 * Migração no boot, DEPOIS de a porta abrir.
 *
 * A hospedagem vigia a porta assim que o processo começa e derruba o serviço
 * se nada escutar dentro da janela dela. Aplicar as migrações antes do
 * `listen` consome essa janela num banco recém-criado, e o processo é morto
 * sem nunca ter respondido — visto de fora, um serviço que não existe.
 *
 * Fazer depois inverte a ordem: a porta abre em milissegundos, e o schema
 * chega segundos depois. A janela entre as duas coisas existe, e é por isso
 * que só se liga isto com RUN_MIGRATIONS_ON_BOOT — em servidor de verdade a
 * migração é passo do deploy, não do processo.
 */
if (env.RUN_MIGRATIONS_ON_BOOT) {
  const run = promisify(execFile);

  try {
    app.log.info("aplicando migrações");
    const { stdout } = await run("node", [
      "node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
    ]);
    app.log.info({ stdout }, "migrações aplicadas");

    // Perfis e catálogo de permissões. Sem eles o RBAC nega tudo para todo
    // mundo, e um banco migrado mas não semeado parece pronto sem estar.
    // Idempotente: repetir a cada deploy não duplica nada.
    const tsx = "node_modules/tsx/dist/cli.mjs";
    await run("node", [tsx, "prisma/seed.ts"]);
    app.log.info("perfis e permissões semeados");

    // Lojas, produtos e contas de exemplo — só onde alguém pediu por escrito.
    if (process.env.SEED_DEMO_DATA === "true") {
      await run("node", [tsx, "prisma/demo-seed.ts"]);
      app.log.info("dados de demonstração semeados");
    }
  } catch (error) {
    // Não derruba o processo: sem isto uma migração com problema tira o
    // sistema do ar inteiro, e ninguém consegue nem ler o erro pela API.
    app.log.error({ error }, "falha ao preparar o banco");
  }
}
