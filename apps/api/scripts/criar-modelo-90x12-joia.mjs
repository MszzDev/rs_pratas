/**
 * Cria o modelo da etiqueta de joia 90x12, com as medidas tiradas do papel.
 *
 * Não são medidas do rótulo do rolo: são as que a régua impressa mostrou, e
 * elas não coincidem. O rolo diz "90 x 12 mm" e é verdade, mas só os primeiros
 * **50 mm** recebem informação — os 30 finais são o "rabo" estreito que enrola
 * na argola e desaparece quando a peça é pendurada.
 *
 * A dobra fica no meio dos 50, dividindo em dois lados de 25 mm. Cada lado
 * mostra o mesmo, e o da direita sai girado 180 graus: ao dobrar ele vira, e
 * sem o giro um dos dois lados apareceria de cabeça para baixo na vitrine.
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

const MODELO = {
  code: "JOIA90",
  name: "Joia 90x12 dobrada",
  widthMm: 90,
  heightMm: 12,
  columnsPerRow: 1,
  gapXMm: 0,
  gapYMm: 3,
  rollWidthMm: 0,
  /** Medido na régua impressa: informação de 0 a 50, rabo de 50 a 80. */
  printableWidthMm: 50,
  isDoubleSided: true,
  showProductName: true,
  showSku: true,
  showPrice: true,
  showSize: false,
  showWeight: false,
  showBarcode: false,
};

console.log("=== Modelo a criar ===\n");
for (const [k, v] of Object.entries(MODELO)) {
  console.log(`  ${k.padEnd(18)} ${v}`);
}
console.log(
  "\n  Cada lado da dobra tem 25 mm, menos 3 mm de folga junto ao vinco:\n" +
    "  nada encosta na dobra, que varia de rolo para rolo e com a mão de quem dobra.",
);

const existente = await prisma.labelTemplate.findFirst({
  where: { code: MODELO.code, deletedAt: null },
  select: { id: true, name: true },
});

/**
 * O código de barras fica de fora.
 *
 * Em 25 mm de largura por 12 de altura ele sairia estreito demais para o
 * leitor pegar, e um código que não lê é pior que código nenhum: a vendedora
 * tenta, falha, e digita à mão de qualquer jeito — só que depois de segurar a
 * fila. O nome e o preço são o que se lê numa etiqueta pendurada.
 */

if (!aplicar) {
  console.log(
    existente
      ? `\nJá existe o modelo ${MODELO.code} ("${existente.name}"). Seria atualizado.`
      : `\nSeria criado.`,
  );
  console.log("Rode de novo com --aplicar para gravar.");
  await prisma.$disconnect();
  process.exit(0);
}

const autor = await prisma.user.findFirst({
  where: { role: "DONO", deletedAt: null },
  select: { id: true, companyId: true },
});

if (!autor) {
  console.log("Nenhum DONO encontrado para constar como autor. Nada feito.");
  await prisma.$disconnect();
  process.exit(1);
}

if (existente) {
  await prisma.labelTemplate.update({ where: { id: existente.id }, data: MODELO });
  console.log(`\nAtualizado: ${MODELO.code}`);
} else {
  await prisma.labelTemplate.create({
    data: { ...MODELO, companyId: autor.companyId, createdById: autor.id },
  });
  console.log(`\nCriado: ${MODELO.code}`);
}

console.log("Escolha ele na hora de imprimir. O padrão da empresa não foi alterado.");

await prisma.$disconnect();
