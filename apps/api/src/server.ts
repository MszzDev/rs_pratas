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
