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

function utilDe(modelo) {
  return Number(modelo.printableWidthMm) > 0
    ? Number(modelo.printableWidthMm)
    : Number(modelo.widthMm);
}

/**
 * Informação de um lado, código de barras do outro.
 *
 * Foi escolha do dono, e é melhor que repetir o mesmo dos dois lados: o código
 * ganha a largura inteira de uma metade em vez de disputar espaço com o texto.
 * Numa etiqueta de 22 mm por lado, essa diferença é o que separa um código que
 * o leitor pega de um que ele não pega — e código que não lê é pior que código
 * nenhum, porque a vendedora tenta, falha, e digita à mão depois de segurar a
 * fila.
 *
 * O desenho cobre os DOIS lados de uma vez: o sistema corta ao meio e gira a
 * metade da direita, porque ao dobrar ela vira de cabeça para baixo.
 */
function desenhoDosDoisLados(utilMm, alturaMm) {
  const metade = utilMm / 2;

  /**
   * O conteúdo encosta na DOBRA, e não fica centrado em cada metade.
   *
   * Foi assim que o dono acertou no papel, depois de várias tentativas minhas
   * centrando cada lado. E faz sentido: a passagem pelo navegador e pelo driver
   * introduz um pequeno desvio, e ele empurra as duas metades para longe uma da
   * outra. Encostando na dobra, o desvio come a margem externa — que é vazia —
   * em vez de jogar o código por cima do vinco.
   *
   * Fica então: margem larga nas bordas de fora, e 1 mm de cada lado do vinco.
   */
  const largura = Math.max(4, Math.round(metade * 0.6));
  const folgaDoVinco = 1;
  const inicioDaInformacao = Math.max(0, metade - folgaDoVinco - largura);

  return [
    {
      id: "nome",
      campo: "NOME",
      xMm: inicioDaInformacao,
      yMm: 0.6,
      larguraMm: largura,
      tamanhoMm: 2,
      negrito: true,
      alinhamento: "center",
    },
    {
      id: "sku",
      campo: "SKU",
      xMm: inicioDaInformacao,
      yMm: 4,
      larguraMm: largura,
      tamanhoMm: 1.6,
      negrito: false,
      alinhamento: "center",
    },
    {
      // O preço é o que o cliente procura na vitrine: maior que o resto.
      id: "preco",
      campo: "PRECO",
      xMm: inicioDaInformacao,
      yMm: Math.max(5, alturaMm - 5.1),
      larguraMm: largura,
      tamanhoMm: 2.8,
      negrito: true,
      alinhamento: "center",
    },
    {
      // Do outro lado do vinco, com a mesma folga.
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
  const util = utilDe(m);
  const novo = desenhoDosDoisLados(util, Number(m.heightMm));

  const atuais = Array.isArray(m.elements) ? m.elements : [];
  const maiorAtual = atuais.reduce((maior, e) => Math.max(maior, Number(e.larguraMm ?? 0)), 0);

  console.log(`\n${m.code} "${m.name}"`);
  console.log(`  etiqueta: ${m.widthMm} x ${m.heightMm} mm, área útil ${m.printableWidthMm} mm`);
  console.log(`  área útil: ${util.toFixed(1)} mm, cada lado com ${(util / 2).toFixed(1)}`);
  console.log(`  desenho atual: ${atuais.length} elemento(s), o mais largo com ${maiorAtual} mm`);
  console.log(`  desenho novo:  informação à esquerda, código de barras à direita`);

  if (aplicar) {
    await prisma.labelTemplate.update({ where: { id: m.id }, data: { elements: novo } });
    console.log("  gravado.");
  }
}

console.log(aplicar ? "\nPronto." : "\nRode de novo com --aplicar para gravar.");

await prisma.$disconnect();
