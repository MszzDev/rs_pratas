/**
 * Diz ao modelo 33x21 que o rolo tem três colunas.
 *
 * O modelo foi criado antes de o sistema saber que rolo pode ter mais de uma
 * coluna, então ficou com o padrão de coluna única e folga zero. Com isso o
 * navegador monta a página com a largura de UMA etiqueta, quebra a linha depois
 * da primeira coluna, e duas de cada três saem em branco.
 *
 * Sem `--aplicar` só mostra o que faria.
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
const aplicar = process.argv.includes("--aplicar");

const modelos = await prisma.labelTemplate.findMany({
  where: { deletedAt: null },
  select: {
    id: true,
    code: true,
    name: true,
    widthMm: true,
    heightMm: true,
    gapXMm: true,
    gapYMm: true,
    columnsPerRow: true,
    isDefault: true,
  },
});

console.log(`${modelos.length} modelo(s):\n`);
for (const m of modelos) {
  const padrao = m.isDefault ? "  (padrão)" : "";
  console.log(
    `  ${m.code}  ${m.name}  ${m.widthMm}x${m.heightMm}mm  ` +
      `${m.columnsPerRow} coluna(s)  folga ${m.gapXMm}mm${padrao}`,
  );
}

// O rolo da loja: 33 mm de etiqueta, três colunas, 1,2 mm entre elas.
const alvos = modelos.filter(
  (m) => Number(m.widthMm) === 33 && Number(m.heightMm) === 21 && m.columnsPerRow === 1,
);

if (alvos.length === 0) {
  console.log("\nNenhum modelo 33x21 em coluna única. Nada a fazer.");
} else if (!aplicar) {
  console.log(`\n${alvos.length} modelo(s) 33x21 ficariam com 3 colunas e folga 1,2mm.`);
  console.log("Rode de novo com --aplicar para gravar.");
} else {
  for (const m of alvos) {
    await prisma.labelTemplate.update({
      where: { id: m.id },
      data: { columnsPerRow: 3, gapXMm: 1.2, gapYMm: 0 },
    });
    console.log(`\n${m.code}: agora 3 colunas, folga 1,2mm.`);
  }
}

await prisma.$disconnect();
