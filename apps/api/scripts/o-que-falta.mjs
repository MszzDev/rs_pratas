/**
 * O que ainda falta para a operação andar sozinha.
 *
 * Só leitura. Cada número aqui é uma pergunta que alguém teria que responder
 * abrindo cinco telas diferentes.
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
  select: { code: true, name: true },
  orderBy: { code: "asc" },
});

const tablets = await prisma.pOSStation.findMany({
  where: { deletedAt: null },
  select: { store: { select: { code: true } } },
});
const maquininhas = await prisma.paymentTerminal.findMany({
  where: { deletedAt: null },
  select: { storeId: true },
});
const codigoDaLoja = new Map(
  (await prisma.store.findMany({ select: { id: true, code: true } })).map((l) => [l.id, l.code]),
);

const comTablet = new Set(tablets.map((t) => t.store.code));
const comMaquininha = new Set(maquininhas.map((m) => codigoDaLoja.get(m.storeId)));

console.log("\n=== LOJA POR LOJA ===\n");
for (const l of lojas) {
  const t = comTablet.has(l.code) ? "tablet OK " : "SEM TABLET";
  const m = comMaquininha.has(l.code) ? "maquininha OK" : "SEM MAQUININHA";
  console.log(`  ${l.code.padEnd(6)} ${l.name.padEnd(24)} ${t}  ${m}`);
}

const comAcabamento = await prisma.product.count({
  where: { deletedAt: null, finish: { not: null } },
});
const total = await prisma.product.count({ where: { deletedAt: null } });

// A jornada aponta para o USUÁRIO, não para um cadastro de funcionário à
// parte: quem bate o ponto é quem entra no sistema.
const comJornada = await prisma.workSchedule.findMany({
  where: { isActive: true },
  select: { userId: true },
  distinct: ["userId"],
});
const pessoas = await prisma.user.findMany({
  where: { deletedAt: null },
  select: { id: true, name: true, role: true },
});
const temJornada = new Set(comJornada.map((j) => j.userId));

console.log("\n=== CADASTROS PELA METADE ===\n");
console.log(`  peças com acabamento preenchido:  ${comAcabamento} de ${total}`);
console.log(`  pessoas COM jornada:              ${temJornada.size} de ${pessoas.length}`);
for (const p of pessoas) {
  if (!temJornada.has(p.id)) console.log(`      sem jornada: ${p.name} (${p.role})`);
}

const semSaldo = await prisma.stockItem.count({
  where: { store: { code: "JANG" }, quantity: 0, product: { deletedAt: null } },
});
console.log(`  peças do JANG ainda com saldo 0:  ${semSaldo}`);

await prisma.$disconnect();
