/**
 * Por que uma etiqueta não chega à fila.
 *
 * São poucas causas possíveis, e todas silenciosas do lado de quem aperta o
 * botão: sem modelo padrão o servidor recusa, sem loja escolhida a fila fica
 * vazia mesmo com trabalhos dentro, e trabalho de outra loja não aparece.
 * Este script mostra as três de uma vez. É só leitura.
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

const modelos = await prisma.labelTemplate.findMany({
  where: { deletedAt: null },
  select: { code: true, name: true, widthMm: true, heightMm: true, isDefault: true, elements: true },
});

console.log("=== MODELOS DE ETIQUETA ===");
if (modelos.length === 0) {
  console.log("  NENHUM. Sem modelo o servidor RECUSA enfileirar — é a causa mais provável.");
} else {
  for (const m of modelos) {
    const desenho = Array.isArray(m.elements) ? `${m.elements.length} elementos` : "sem desenho";
    console.log(
      `  ${m.isDefault ? "[padrão] " : "         "}${m.code} — ${m.name} · ${m.widthMm}x${m.heightMm}mm · ${desenho}`,
    );
  }

  if (!modelos.some((m) => m.isDefault)) {
    console.log("\n  ATENÇÃO: nenhum está marcado como PADRÃO.");
    console.log("  A impressão por peça usa o padrão quando não se indica outro — sem ele, recusa.");
  }
}

const jobs = await prisma.printJob.findMany({
  select: { id: true, status: true, copies: true, createdAt: true, storeId: true, lastError: true },
  orderBy: { createdAt: "desc" },
  take: 10,
});

console.log("\n=== FILA DE IMPRESSÃO (10 mais recentes) ===");
if (jobs.length === 0) {
  console.log("  VAZIA. Nenhum trabalho foi criado — o pedido não chegou ao servidor.");
} else {
  const lojas = new Map(
    (await prisma.store.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]),
  );

  for (const j of jobs) {
    console.log(
      `  ${j.createdAt.toLocaleString("pt-BR")} · ${j.status} · ${j.copies}x · ${lojas.get(j.storeId) ?? j.storeId}` +
        (j.lastError ? ` · erro: ${j.lastError}` : ""),
    );
  }
}

console.log("\n=== LOJAS ===");
for (const loja of await prisma.store.findMany({
  where: { deletedAt: null },
  select: { name: true, code: true },
})) {
  console.log(`  ${loja.code} — ${loja.name}`);
}

await prisma.$disconnect();
