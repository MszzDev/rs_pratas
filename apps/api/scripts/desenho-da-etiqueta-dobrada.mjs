/**
 * Monta um desenho que cabe num lado da etiqueta dobrada.
 *
 * O desenho que estava no modelo tinha elementos de 87 mm de largura, porque o
 * editor mostrava a etiqueta inteira de 90 mm. Mas numa etiqueta que dobra cada
 * lado tem **22 mm**: metade da área útil de 50, menos 3 mm de folga junto ao
 * vinco — onde letra sai rachada porque a dobra não cai sempre no mesmo lugar.
 *
 * Refazer isso na tela seria apagar quatro elementos e reposicionar tudo num
 * espaço nove vezes menor. Este script deixa pronto o que costuma servir, e o
 * ajuste fino continua no editor.
 *
 * ## O que entra, e o que fica de fora
 *
 * Em 22 por 12 milímetros cabe pouco, e a escolha importa mais do que num
 * espaço grande: nome, código e preço. **Sem código de barras** — em 22 mm ele
 * sairia estreito demais para o leitor pegar, e código que não lê é pior que
 * código nenhum: a vendedora tenta, falha, e digita à mão de qualquer jeito, só
 * que depois de segurar a fila.
 *
 * Peça que precisa de código de barras vai no rolo de 33 × 21, que tem espaço.
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

/** A folga junto ao vinco, igual à que o gerador usa ao imprimir. */
const FOLGA_DO_VINCO = 3;

function ladoDe(modelo) {
  const util = Number(modelo.printableWidthMm) > 0
    ? Number(modelo.printableWidthMm)
    : Number(modelo.widthMm);

  return Math.max(6, util / 2 - FOLGA_DO_VINCO);
}

/** Nome em cima, código no meio, preço embaixo e maior. */
function desenhoDeUmLado(larguraMm, alturaMm) {
  const margem = 1;
  const largura = Math.max(4, larguraMm - margem * 2);

  return [
    {
      id: "nome",
      campo: "NOME",
      xMm: margem,
      yMm: 0.8,
      larguraMm: largura,
      tamanhoMm: 2,
      negrito: true,
      alinhamento: "center",
    },
    {
      id: "sku",
      campo: "SKU",
      xMm: margem,
      yMm: 3.6,
      larguraMm: largura,
      tamanhoMm: 1.6,
      negrito: false,
      alinhamento: "center",
    },
    {
      // O preço é o que o cliente procura na vitrine: maior que o resto.
      id: "preco",
      campo: "PRECO",
      xMm: margem,
      yMm: Math.max(6, alturaMm - 4.2),
      larguraMm: largura,
      tamanhoMm: 2.8,
      negrito: true,
      alinhamento: "center",
    },
  ];
}

const modelos = await prisma.labelTemplate.findMany({
  where: { deletedAt: null, isDoubleSided: true },
  select: {
    id: true,
    code: true,
    name: true,
    widthMm: true,
    heightMm: true,
    printableWidthMm: true,
    elements: true,
  },
});

if (modelos.length === 0) {
  console.log("Nenhum modelo dobrado. Nada a fazer.");
  await prisma.$disconnect();
  process.exit(0);
}

for (const m of modelos) {
  const lado = ladoDe(m);
  const novo = desenhoDeUmLado(lado, Number(m.heightMm));

  const atuais = Array.isArray(m.elements) ? m.elements : [];
  const maiorAtual = atuais.reduce((maior, e) => Math.max(maior, Number(e.larguraMm ?? 0)), 0);

  console.log(`\n${m.code} "${m.name}"`);
  console.log(`  etiqueta: ${m.widthMm} x ${m.heightMm} mm, área útil ${m.printableWidthMm} mm`);
  console.log(`  cada lado: ${lado.toFixed(1)} x ${m.heightMm} mm`);
  console.log(`  desenho atual: ${atuais.length} elemento(s), o mais largo com ${maiorAtual} mm`);
  console.log(`  desenho novo:  ${novo.length} elementos (nome, código, preço), cabendo em ${lado.toFixed(1)} mm`);

  if (aplicar) {
    await prisma.labelTemplate.update({ where: { id: m.id }, data: { elements: novo } });
    console.log("  gravado.");
  }
}

console.log(aplicar ? "\nPronto." : "\nRode de novo com --aplicar para gravar.");

await prisma.$disconnect();
