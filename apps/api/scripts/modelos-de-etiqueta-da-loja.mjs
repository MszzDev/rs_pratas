/**
 * Deixa no sistema só os dois modelos que a loja usa de verdade.
 *
 * Os anteriores nasceram de tentativa e erro, com códigos inventados na hora —
 * "001", "005", "222222", "tesq1" — e medidas de várias etapas do acerto. Manter
 * isso é deixar quem for imprimir escolher entre seis opções, das quais quatro
 * estão erradas e ninguém sabe quais.
 *
 * Os dois que ficam têm as medidas conferidas no papel e o nome dizendo **para
 * que servem**, não o tamanho: quem vai etiquetar pensa em "peça de vitrine" ou
 * "joia pendurada", não em "33 por 21".
 *
 * Os antigos são REMOVIDOS, não apagados: `deletedAt` preserva o histórico das
 * etiquetas que já saíram por eles.
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

/** O desenho empilhado da etiqueta de vitrine: nome, código, barras, preço. */
function desenhoDeVitrine(larguraMm, alturaMm) {
  const margem = 1.5;
  const largura = larguraMm - margem * 2;

  return [
    {
      id: "nome",
      campo: "NOME",
      xMm: margem,
      yMm: 1.2,
      larguraMm: largura,
      tamanhoMm: 2.4,
      negrito: true,
      alinhamento: "center",
    },
    {
      id: "sku",
      campo: "SKU",
      xMm: margem,
      yMm: 4.4,
      larguraMm: largura,
      tamanhoMm: 1.8,
      negrito: false,
      alinhamento: "center",
    },
    {
      id: "barras",
      campo: "CODIGO_BARRAS",
      xMm: margem,
      yMm: 7,
      larguraMm: largura,
      alturaMm: 6.5,
      tamanhoMm: 1.5,
      negrito: false,
      alinhamento: "center",
    },
    {
      id: "preco",
      campo: "PRECO",
      xMm: margem,
      yMm: alturaMm - 4,
      larguraMm: largura,
      tamanhoMm: 3,
      negrito: true,
      alinhamento: "center",
    },
  ];
}

/**
 * O desenho da etiqueta dobrada, com o conteúdo encostado no vinco.
 *
 * Foi o dono quem acertou essas posições no papel, depois de várias tentativas
 * minhas centrando cada metade. A passagem pelo navegador e pelo driver
 * introduz um pequeno desvio que empurra as duas metades para longe uma da
 * outra; encostando na dobra, o desvio come a margem externa — que é vazia — em
 * vez de jogar o código por cima do vinco.
 */
function desenhoDeJoia(utilMm, alturaMm) {
  const metade = utilMm / 2;
  const largura = Math.max(4, Math.round(metade * 0.6));
  const folgaDoVinco = 1;
  const inicio = Math.max(0, metade - folgaDoVinco - largura);

  return [
    { id: "nome", campo: "NOME", xMm: inicio, yMm: 0.6, larguraMm: largura, tamanhoMm: 2, negrito: true, alinhamento: "center" },
    { id: "sku", campo: "SKU", xMm: inicio, yMm: 4, larguraMm: largura, tamanhoMm: 1.6, negrito: false, alinhamento: "center" },
    { id: "preco", campo: "PRECO", xMm: inicio, yMm: alturaMm - 5.1, larguraMm: largura, tamanhoMm: 2.8, negrito: true, alinhamento: "center" },
    {
      id: "barras",
      campo: "CODIGO_BARRAS",
      xMm: metade + folgaDoVinco,
      yMm: 2.3,
      larguraMm: largura,
      alturaMm: Math.max(5, alturaMm - 5),
      tamanhoMm: 1.4,
      negrito: false,
      alinhamento: "center",
    },
  ];
}

const MODELOS = [
  {
    code: "ET0001",
    // O nome diz para que serve, e não o tamanho: quem etiqueta pensa na peça.
    name: "Peça de vitrine (rolo de 3 colunas)",
    widthMm: 33,
    heightMm: 21,
    columnsPerRow: 3,
    gapXMm: 1.2,
    gapYMm: 3.1,
    rollWidthMm: 104,
    printableWidthMm: 0,
    isDoubleSided: false,
    showProductName: true,
    showSku: true,
    showPrice: true,
    showSize: true,
    showWeight: false,
    showBarcode: true,
    isDefault: true,
    elements: desenhoDeVitrine(33, 21),
  },
  {
    code: "ET0002",
    name: "Joia pendurada na argola (dobrada)",
    widthMm: 90,
    heightMm: 12,
    columnsPerRow: 1,
    gapXMm: 0,
    gapYMm: 3,
    rollWidthMm: 0,
    printableWidthMm: 50,
    isDoubleSided: true,
    showProductName: true,
    showSku: true,
    showPrice: true,
    showSize: false,
    showWeight: false,
    showBarcode: true,
    isDefault: false,
    elements: desenhoDeJoia(50, 12),
  },
];

const existentes = await prisma.labelTemplate.findMany({
  where: { deletedAt: null },
  select: { id: true, code: true, name: true },
});

const codigosNovos = MODELOS.map((m) => m.code);
const aRemover = existentes.filter((e) => !codigosNovos.includes(e.code));

console.log("=== MODELOS QUE FICAM ===\n");
for (const m of MODELOS) {
  console.log(`  ${m.code}  "${m.name}"`);
  console.log(`    ${m.widthMm} x ${m.heightMm} mm, ${m.columnsPerRow} coluna(s)` +
    (m.isDoubleSided ? `, dobrada, área útil ${m.printableWidthMm} mm` : "") +
    (m.isDefault ? "  (padrão)" : ""));
}

console.log("\n=== MODELOS A REMOVER ===\n");
if (aRemover.length === 0) console.log("  nenhum");
for (const e of aRemover) console.log(`  ${e.code}  "${e.name}"`);

if (!aplicar) {
  console.log("\nRode de novo com --aplicar para gravar.");
  await prisma.$disconnect();
  process.exit(0);
}

const autor = await prisma.user.findFirst({
  where: { role: "DONO", deletedAt: null },
  select: { id: true, companyId: true },
});

if (!autor) {
  console.log("\nNenhum DONO encontrado para constar como autor. Nada feito.");
  await prisma.$disconnect();
  process.exit(1);
}

// Remove antes de criar: o padrão é único, e dois padrões ao mesmo tempo fazem
// a fila escolher um deles sem critério.
for (const e of aRemover) {
  await prisma.labelTemplate.update({
    where: { id: e.id },
    data: { deletedAt: new Date(), isDefault: false, isActive: false },
  });
}

for (const m of MODELOS) {
  const existente = existentes.find((e) => e.code === m.code);

  if (existente) {
    await prisma.labelTemplate.update({ where: { id: existente.id }, data: m });
  } else {
    await prisma.labelTemplate.create({
      data: { ...m, companyId: autor.companyId, createdById: autor.id },
    });
  }
}

console.log(`\n${aRemover.length} removido(s), ${MODELOS.length} no lugar.`);

await prisma.$disconnect();
