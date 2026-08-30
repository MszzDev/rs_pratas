/**
 * Cria o modelo de etiqueta 33 x 21 mm e o deixa como padrão da empresa.
 *
 * Existe porque a loja precisa imprimir hoje e os dois modelos cadastrados
 * estavam com 90 x 12 — a medida da fita inteira, não de uma etiqueta. Com a
 * medida errada o desenho sai esticado por cima das três colunas e cortado em
 * cada uma.
 *
 *   node scripts/criar-modelo-33x21.mjs --conferir   diz o que faria
 *   node scripts/criar-modelo-33x21.mjs --criar      cria de verdade
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

const modo = process.argv[2];
if (modo !== "--conferir" && modo !== "--criar") {
  console.error("Use --conferir ou --criar.");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: conexaoGuardada() } } });

const empresa = await prisma.company.findFirst({ select: { id: true, tradeName: true } });
if (!empresa) {
  console.error("Nenhuma empresa cadastrada.");
  process.exit(1);
}

/**
 * Quem consta como autor do modelo.
 *
 * O campo é obrigatório porque toda linha do sistema tem dono — é o que
 * permite responder "quem criou isto" meses depois. Aqui vai o dono da
 * empresa, que é quem pediu.
 */
const autor = await prisma.user.findFirst({
  where: { companyId: empresa.id, role: "DONO", deletedAt: null },
  select: { id: true, name: true },
});

if (!autor) {
  console.error("Nenhum dono cadastrado para constar como autor do modelo.");
  process.exit(1);
}

const LARGURA = 33;
const ALTURA = 21;

/**
 * O desenho, montado aqui e não deixado em branco.
 *
 * Um modelo sem desenho cai no formato empilhado antigo, que foi pensado para
 * a etiqueta comprida de argola. Em 33 x 21 ele sai apertado. Este desenho é o
 * mesmo `desenhoPadrao` do editor, com as medidas desta etiqueta: nome em
 * cima, código abaixo, barras no meio e preço no rodapé.
 */
const margem = Math.min(1.5, LARGURA * 0.06);
const largura = LARGURA - margem * 2;

const desenho = [
  {
    id: "nome",
    campo: "NOME",
    xMm: margem,
    yMm: margem,
    larguraMm: largura,
    tamanhoMm: 2,
    negrito: true,
    alinhamento: "center",
  },
  {
    id: "sku",
    campo: "SKU",
    xMm: margem,
    yMm: margem + 3,
    larguraMm: largura,
    tamanhoMm: 1.8,
    negrito: false,
    alinhamento: "center",
  },
  {
    id: "barras",
    campo: "CODIGO_BARRAS",
    xMm: margem,
    yMm: margem + 5.6,
    larguraMm: largura,
    alturaMm: Math.max(4, ALTURA * 0.3),
    tamanhoMm: 1.6,
    negrito: false,
    alinhamento: "center",
  },
  {
    id: "preco",
    campo: "PRECO",
    xMm: margem,
    yMm: Math.max(margem + 9, ALTURA - margem - 3),
    larguraMm: largura,
    tamanhoMm: 2.6,
    negrito: true,
    alinhamento: "center",
  },
];

const existente = await prisma.labelTemplate.findFirst({
  where: { companyId: empresa.id, code: "JOIA33", deletedAt: null },
});

console.log(`Empresa: ${empresa.tradeName}`);
console.log(`Modelo: JOIA33 — ${LARGURA} x ${ALTURA} mm, ${desenho.length} elementos`);
console.log(existente ? "Já existe: seria atualizado e virado padrão." : "Seria criado como padrão.");

if (modo === "--conferir") {
  const outros = await prisma.labelTemplate.findMany({
    where: { companyId: empresa.id, deletedAt: null },
    select: { code: true, widthMm: true, heightMm: true, isDefault: true },
  });

  console.log("\nModelos hoje:");
  for (const m of outros) {
    console.log(`  ${m.isDefault ? "[padrão] " : "         "}${m.code} · ${m.widthMm}x${m.heightMm}mm`);
  }

  await prisma.$disconnect();
  process.exit(0);
}

await prisma.$transaction(async (tx) => {
  // Só um padrão por empresa: os outros perdem a marca.
  await tx.labelTemplate.updateMany({
    where: { companyId: empresa.id, isDefault: true },
    data: { isDefault: false },
  });

  const dados = {
    name: "Joia 33x21",
    widthMm: LARGURA,
    heightMm: ALTURA,
    isDoubleSided: false,
    showProductName: true,
    showSku: true,
    showPrice: true,
    showWeight: false,
    showSize: true,
    showBarcode: true,
    isDefault: true,
    elements: desenho,
  };

  if (existente) {
    await tx.labelTemplate.update({ where: { id: existente.id }, data: dados });
  } else {
    await tx.labelTemplate.create({
      data: { companyId: empresa.id, code: "JOIA33", createdById: autor.id, ...dados },
    });
  }
});

const conferido = await prisma.labelTemplate.findFirst({
  where: { companyId: empresa.id, code: "JOIA33" },
  select: { code: true, widthMm: true, heightMm: true, isDefault: true, elements: true },
});

console.log("\nPronto:");
console.log(
  `  ${conferido.code} · ${conferido.widthMm}x${conferido.heightMm}mm · padrão: ${conferido.isDefault} · ` +
    `${Array.isArray(conferido.elements) ? conferido.elements.length : 0} elementos`,
);

await prisma.$disconnect();
