/**
 * Grava a largura TOTAL da bobina no modelo de várias colunas.
 *
 * Sem esse número o sistema calcula a página somando só as colunas e as folgas
 * entre elas — 101,4 mm no rolo da loja. Mas a bobina tem 104: sobram 2,6 mm de
 * papel exposto, 1,3 de cada lado, e é essa borda que centraliza o desenho nos
 * recortes. Sem ela tudo encosta na esquerda e o conteúdo de uma etiqueta
 * invade a vizinha.
 *
 * O valor precisa bater exatamente com o papel configurado no driver da
 * impressora. Quando não bate, o navegador escala a página inteira em silêncio.
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

/** O rolo da loja: 1,3 + 33 + 1,2 + 33 + 1,2 + 33 + 1,3 = 104,0 mm. */
const BOBINA_MM = 104;

const alvos = await prisma.labelTemplate.findMany({
  where: { deletedAt: null, columnsPerRow: { gt: 1 } },
  select: {
    id: true,
    code: true,
    name: true,
    widthMm: true,
    gapXMm: true,
    columnsPerRow: true,
    rollWidthMm: true,
  },
});

if (alvos.length === 0) {
  console.log("Nenhum modelo de várias colunas. Nada a fazer.");
} else {
  for (const m of alvos) {
    const conteudo = Number(m.widthMm) * m.columnsPerRow + Number(m.gapXMm) * (m.columnsPerRow - 1);
    const borda = (BOBINA_MM - conteudo) / 2;

    console.log(`  ${m.code} "${m.name}"`);
    console.log(`    colunas + folgas: ${conteudo.toFixed(1)}mm`);
    console.log(`    bobina: ${m.rollWidthMm}mm -> ${BOBINA_MM}mm`);
    console.log(`    borda de cada lado: ${borda.toFixed(2)}mm`);

    if (aplicar) {
      await prisma.labelTemplate.update({
        where: { id: m.id },
        data: { rollWidthMm: BOBINA_MM },
      });
    }
  }

  console.log(aplicar ? "\nGravado." : "\nRode de novo com --aplicar para gravar.");
}

await prisma.$disconnect();
