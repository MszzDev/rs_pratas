/**
 * O estado das integrações: conectadas, com qual loja, e quando sincronizaram.
 *
 * A pergunta que ele responde é a que mais importa na Nuvemshop: **qual loja
 * alimenta o site**. Publicar o estoque da loja errada faz a vitrine vender
 * peça que está em outra unidade e não tem como despachar.
 *
 * É só leitura.
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

const prisma = new PrismaClient({ datasources: { db: { url: conexaoGuardada() } } });

const lojas = await prisma.store.findMany({
  where: { deletedAt: null },
  select: { id: true, code: true, name: true },
  orderBy: { name: "asc" },
});

console.log("=== LOJAS ===\n");
for (const l of lojas) console.log(`  ${l.code.padEnd(8)} ${l.name}`);

const integracoes = await prisma.integration.findMany({
  select: {
    provider: true,
    status: true,
    storeId: true,
    lastSyncAt: true,
    lastError: true,
  },
});

console.log("\n=== INTEGRAÇÕES ===\n");

if (integracoes.length === 0) console.log("  nenhuma configurada");

for (const i of integracoes) {
  const loja = lojas.find((l) => l.id === i.storeId);
  console.log(`  ${i.provider}  ${i.status}`);
  console.log(`    loja que alimenta o site: ${loja ? loja.name : "NENHUMA ESCOLHIDA"}`);
  console.log(`    última sincronia: ${i.lastSyncAt?.toLocaleString("pt-BR") ?? "nunca"}`);
  if (i.lastError) console.log(`    último erro: ${i.lastError}`);
  console.log("");
}

await prisma.$disconnect();
