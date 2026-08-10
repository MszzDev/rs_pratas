import { execSync } from "node:child_process";
import { join } from "node:path";
import { config } from "dotenv";

/**
 * Roda uma vez antes de toda a suíte: aplica as migrações no banco de testes e
 * semeia perfis e permissões (o motor de RBAC depende deles existirem).
 */
export async function setup() {
  config({ path: ".env.test", override: true });

  const migrateUrl = process.env.DATABASE_MIGRATE_URL;
  if (!migrateUrl) {
    throw new Error("DATABASE_MIGRATE_URL ausente — confira o apps/api/.env.test");
  }

  // O PATH do subprocesso não inclui node_modules/.bin de forma confiável, e no
  // Windows o Node recusa executar .CMD diretamente — daí caminho absoluto entre
  // aspas via shell.
  const binDir = join(process.cwd(), "node_modules", ".bin");
  const run = (binary: string, args: string, env: NodeJS.ProcessEnv) =>
    execSync(`"${join(binDir, binary)}" ${args}`, { stdio: "inherit", env });

  run("prisma", "migrate deploy --schema=prisma/schema.prisma", {
    ...process.env,
    DATABASE_URL: migrateUrl,
  });

  run("tsx", "prisma/seed.ts", process.env);
}
