/**
 * A coluna já existe no banco de produção?
 *
 * As migrações rodam no deploy do Render, que leva alguns minutos e acontece
 * fora daqui. Um script que precisa de coluna nova falha com um erro do Prisma
 * de vinte linhas quando ela ainda não subiu — e o erro não deixa claro que é
 * só questão de esperar.
 *
 * Perguntar ao catálogo do Postgres responde em uma linha.
 *
 * Uso: node scripts/conferir-coluna.mjs label_templates printableWidthMm
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

function conexaoGuardada() {
  const caminho = join(process.cwd(), "..", "..", ".env.backup");
  const bruto = readFileSync(caminho);
  const utf16 = bruto[0] === 0xff && bruto[1] === 0xfe;
  const texto = bruto.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");

  const achou = /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(texto);
  if (!achou) throw new Error("DATABASE_URL não encontrada em .env.backup");

  return achou[1].trim().replace(/^["']|["']$/g, "");
}

const [tabela, coluna] = process.argv.slice(2);

if (!tabela || !coluna) {
  console.log("Uso: node scripts/conferir-coluna.mjs <tabela> <coluna>");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: conexaoGuardada() } } });

const linhas = await prisma.$queryRawUnsafe(
  `SELECT column_name, data_type
     FROM information_schema.columns
    WHERE table_name = $1 AND column_name = $2`,
  tabela,
  coluna,
);

if (linhas.length > 0) {
  console.log(`EXISTE: ${tabela}.${coluna} (${linhas[0].data_type})`);
} else {
  console.log(`AINDA NÃO: ${tabela}.${coluna} — a migração não subiu no Render.`);
}

await prisma.$disconnect();
