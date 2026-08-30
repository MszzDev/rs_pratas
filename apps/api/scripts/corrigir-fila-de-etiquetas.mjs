/**
 * Ensina os trabalhos que já estão na fila sobre as colunas do rolo.
 *
 * O payload de um trabalho é congelado quando ele entra na fila, para a
 * etiqueta sair com o preço do momento em que foi pedida. O efeito colateral é
 * que trabalhos criados antes de o sistema saber que rolo pode ter mais de uma
 * coluna carregam `columnsPerRow` ausente — e imprimem numa coluna só,
 * desperdiçando duas de cada três etiquetas.
 *
 * Este script copia as colunas e a folga do MODELO para o payload dos
 * trabalhos que ainda não foram impressos. Não toca em preço, nome nem código:
 * só no bloco `layout`, que descreve o papel e não o produto.
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

const trabalhos = await prisma.printJob.findMany({
  where: { status: "NA_FILA" },
  select: {
    id: true,
    payload: true,
    template: { select: { code: true, columnsPerRow: true, gapXMm: true, gapYMm: true } },
  },
});

console.log(`${trabalhos.length} trabalho(s) na fila.\n`);

let corrigir = 0;

for (const t of trabalhos) {
  if (!t.template) continue;

  const payload = t.payload;
  const layout = payload?.layout;
  if (!layout) continue;

  const colunasNoModelo = t.template.columnsPerRow;
  const jaTem = layout.columnsPerRow === colunasNoModelo;
  if (jaTem) continue;

  corrigir++;

  const novoLayout = {
    ...layout,
    columnsPerRow: colunasNoModelo,
    gapXMm: Number(t.template.gapXMm),
    gapYMm: Number(t.template.gapYMm),
  };

  if (aplicar) {
    await prisma.printJob.update({
      where: { id: t.id },
      data: { payload: { ...payload, layout: novoLayout } },
    });
  }
}

if (corrigir === 0) {
  console.log("Todos os trabalhos já sabem as colunas do rolo. Nada a fazer.");
} else if (aplicar) {
  console.log(`${corrigir} trabalho(s) corrigido(s).`);
} else {
  console.log(`${corrigir} trabalho(s) seriam corrigidos.`);
  console.log("Rode de novo com --aplicar para gravar.");
}

await prisma.$disconnect();
