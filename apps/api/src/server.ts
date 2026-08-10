import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "encerrando");
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: env.PORT, host: "0.0.0.0" });
