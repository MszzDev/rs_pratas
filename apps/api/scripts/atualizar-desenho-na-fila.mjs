/**
 * Troca o desenho dos trabalhos que ainda estão na fila pelo do modelo atual.
 *
 * O payload é congelado quando a etiqueta entra na fila, e isso é proposital: a
 * etiqueta precisa sair com o preço do momento em que foi pedida, e não com o
 * preço de quando a impressora finalmente respondeu.
 *
 * O efeito colateral aparece quando o que congelou estava errado. Foi o caso do
 * desenho da etiqueta dobrada: ele foi montado com elementos de 87 mm porque o
 * editor mostrava a etiqueta inteira, e corrigir o modelo depois não alcança o
 * que já está na fila. A dona corrige, manda imprimir, e sai igual — sem nada
 * na tela explicando por quê.
 *
 * Este script troca **só o desenho**. Preço, nome e código continuam vindo
 * congelados, que é o motivo de congelar.
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
  where: { status: "NA_FILA", type: "ETIQUETA" },
  select: {
    id: true,
    payload: true,
    template: {
      select: {
        code: true,
        name: true,
        elements: true,
        widthMm: true,
        heightMm: true,
        gapXMm: true,
        gapYMm: true,
        columnsPerRow: true,
        rollWidthMm: true,
        printableWidthMm: true,
        isDoubleSided: true,
      },
    },
  },
});

if (trabalhos.length === 0) {
  console.log("Nenhuma etiqueta na fila. Nada a fazer.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`${trabalhos.length} etiqueta(s) na fila.\n`);

let mexidos = 0;

for (const t of trabalhos) {
  if (!t.template) continue;

  const layout = t.payload?.layout;
  if (!layout) continue;

  const novoLayout = {
    ...layout,
    elements: t.template.elements ?? null,
    widthMm: Number(t.template.widthMm),
    heightMm: Number(t.template.heightMm),
    gapXMm: Number(t.template.gapXMm),
    gapYMm: Number(t.template.gapYMm),
    columnsPerRow: t.template.columnsPerRow,
    rollWidthMm: Number(t.template.rollWidthMm),
    printableWidthMm: Number(t.template.printableWidthMm),
    isDoubleSided: t.template.isDoubleSided,
  };

  mexidos++;

  if (aplicar) {
    await prisma.printJob.update({
      where: { id: t.id },
      data: { payload: { ...t.payload, layout: novoLayout } },
    });
  }
}

const modelo = trabalhos[0]?.template;
if (modelo) {
  const elementos = Array.isArray(modelo.elements) ? modelo.elements : [];
  const maisLargo = elementos.reduce((m, e) => Math.max(m, Number(e.larguraMm ?? 0)), 0);
  console.log(`Modelo ${modelo.code} "${modelo.name}"`);
  console.log(`  ${elementos.length} elemento(s), o mais largo com ${maisLargo} mm`);
  console.log(`  ${modelo.widthMm} x ${modelo.heightMm} mm, área útil ${modelo.printableWidthMm} mm`);
}

console.log(
  aplicar
    ? `\n${mexidos} trabalho(s) atualizados com o desenho de agora.`
    : `\n${mexidos} trabalho(s) seriam atualizados.\nRode de novo com --aplicar para gravar.`,
);

await prisma.$disconnect();
