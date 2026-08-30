/**
 * Mostra o que o sistema manda para a folha de impressão.
 *
 * Quando a etiqueta sai errada, a pergunta é sempre a mesma: o desenho está
 * errado, ou o dado que chega nele está? Este script responde a segunda parte
 * imprimindo o `layout` que vai junto de cada trabalho, e os modelos que
 * existem, sem precisar abrir o navegador.
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

console.log("=== MODELOS ===\n");
const modelos = await prisma.labelTemplate.findMany({
  where: { deletedAt: null },
  select: {
    code: true,
    name: true,
    widthMm: true,
    heightMm: true,
    gapXMm: true,
    columnsPerRow: true,
    isDefault: true,
    elements: true,
  },
});

for (const m of modelos) {
  const desenho = Array.isArray(m.elements) ? `${m.elements.length} elementos` : "sem desenho";
  console.log(
    `  ${m.code}  "${m.name}"  ${m.widthMm}x${m.heightMm}mm  ` +
      `${m.columnsPerRow} col  folga ${m.gapXMm}mm  ${desenho}` +
      (m.isDefault ? "  (padrão)" : ""),
  );
}

console.log("\n=== TRABALHOS NA FILA ===\n");
const trabalhos = await prisma.printJob.findMany({
  where: { status: "NA_FILA" },
  take: 3,
  orderBy: { createdAt: "desc" },
  select: { id: true, createdAt: true, payload: true, template: { select: { code: true } } },
});

if (trabalhos.length === 0) {
  console.log("  (fila vazia)");
}

for (const t of trabalhos) {
  console.log(`  ${t.createdAt.toLocaleString("pt-BR")}  modelo ${t.template?.code ?? "-"}`);
  console.log(`  layout: ${JSON.stringify(t.payload?.layout)}`);
  console.log("");
}

await prisma.$disconnect();
