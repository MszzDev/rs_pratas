/**
 * Grava o intervalo entre linhas no modelo 33x21 da loja.
 *
 * O modelo foi criado antes de o sistema pedir esse número, então ficou com
 * zero. Com zero, a página declarada tem o tamanho do corpo da etiqueta e não
 * o passo do rolo — sobra o intervalo a cada avanço, o desvio vai somando, e
 * quando passa de uma etiqueta começa a sair etiqueta em branco. Depois duas,
 * depois três.
 *
 * O valor de 3,1 mm é o que o próprio driver da Elgin informa para este rolo.
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

const INTERVALO_MM = 3.1;

const alvos = await prisma.labelTemplate.findMany({
  where: { deletedAt: null, columnsPerRow: { gt: 1 } },
  select: { id: true, code: true, name: true, heightMm: true, gapYMm: true },
});

if (alvos.length === 0) {
  console.log("Nenhum modelo de várias colunas. Nada a fazer.");
} else {
  for (const m of alvos) {
    const passo = Number(m.heightMm) + INTERVALO_MM;
    console.log(
      `  ${m.code} "${m.name}"  intervalo ${m.gapYMm}mm -> ${INTERVALO_MM}mm  ` +
        `(passo do rolo: ${passo}mm)`,
    );

    if (aplicar) {
      await prisma.labelTemplate.update({
        where: { id: m.id },
        data: { gapYMm: INTERVALO_MM },
      });
    }
  }

  console.log(
    aplicar ? "\nGravado." : "\nRode de novo com --aplicar para gravar.",
  );
}

await prisma.$disconnect();
