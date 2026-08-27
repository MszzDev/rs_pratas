#!/usr/bin/env node
/**
 * Deixa o estoque pronto para a contagem.
 *
 *   cd apps/api
 *   node scripts/preparar-estoque.mjs --conferir   mostra o que faria
 *   node scripts/preparar-estoque.mjs              faz
 *
 * Põe cada peça real em ZERO, em cada loja real. Sem uma linha de saldo, a
 * peça simplesmente não aparece na tela de Estoque — e não dá para contar o
 * que não está na lista. Zero não é um palpite: é "ninguém contou ainda", que
 * é exatamente a verdade antes da primeira conferência.
 *
 * É seguro rodar de novo. Peça que já tem saldo não é tocada: o script só cria
 * o que falta, então rodá-lo depois de uma importação nova acrescenta os que
 * chegaram sem mexer no que já foi contado.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE SCRIPT NÃO FAZ, E POR QUÊ
 *
 * Ele não apaga o histórico das lojas de demonstração. Não é escolha: o banco
 * recusa. `sale_items`, `sale_payments`, `cash_movements`, `stock_movements`,
 * `inventory_counts`, `audit_logs` e `time_clock_entries` são append-only, com
 * trava no próprio Postgres — nem a aplicação nem o dono conseguem apagar uma
 * linha. Foi construído assim para que ninguém possa reescrever quanto entrou
 * no caixa depois do fato.
 *
 * Como consequência, a venda de demonstração e o turno de caixa dela ficam no
 * banco para sempre. O que resolve a tela é outra coisa, e já está feita: as
 * listagens de estoque, caixa e vendas passaram a filtrar loja removida. O que
 * pertencia a uma loja que não existe mais deixou de aparecer — continua
 * gravado, e não atrapalha mais ninguém.
 * ---------------------------------------------------------------------------
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A mesma conexão que o backup usa, quando não há DATABASE_URL no ambiente.
 *
 * O arquivo mora na raiz do projeto, duas pastas acima daqui — é o mesmo que a
 * cópia semanal lê, e ter dois lugares com a senha do banco seria um a mais.
 */
function conexaoGuardada() {
  const caminho = join(process.cwd(), "..", "..", ".env.backup");
  if (!existsSync(caminho)) return null;

  const bruto = readFileSync(caminho);
  const utf16 = bruto[0] === 0xff && bruto[1] === 0xfe;
  const texto = bruto.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");

  for (const linha of texto.split(/\r?\n/)) {
    const achou = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+)$/.exec(linha);
    if (achou) return achou[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const url = process.env.DATABASE_URL ?? conexaoGuardada();

if (!url) {
  console.error("Informe DATABASE_URL ou grave a conexão em ../../.env.backup.");
  process.exit(1);
}

const conferir = process.argv.includes("--conferir");

/**
 * Diz em qual banco vai mexer, antes de mexer.
 *
 * Sem isto o script parece o mesmo rodando contra o banco da loja e contra um
 * banco de teste esquecido na máquina — e a diferença entre os dois é o
 * estoque de cinco quiosques. O endereço aparece sem a senha.
 */
const alvo = new URL(url);
console.log(`Banco: ${alvo.hostname}${alvo.pathname}\n`);

const prisma = new PrismaClient({ datasources: { db: { url } } });

const [produtos, lojas] = await Promise.all([
  prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, companyId: true },
  }),
  prisma.store.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  }),
]);

// ------------------------------------------------- o que está apenas escondido

const escondidos = await prisma.stockItem.count({
  where: {
    OR: [{ product: { deletedAt: { not: null } } }, { store: { deletedAt: { not: null } } }],
  },
});

if (escondidos > 0) {
  console.log(
    `${escondidos} saldo(s) pertencem a peça ou loja removida. Continuam gravados —\n` +
      `a movimentação que os gerou é append-only — e já não aparecem em tela nenhuma.\n`,
  );
}

// ------------------------------------------------------------- o que falta

const existentes = await prisma.stockItem.findMany({
  where: { variationId: null },
  select: { storeId: true, productId: true },
});

const jaTem = new Set(existentes.map((item) => `${item.storeId}:${item.productId}`));

const aCriar = [];
for (const loja of lojas) {
  for (const produto of produtos) {
    if (jaTem.has(`${loja.id}:${produto.id}`)) continue;
    aCriar.push({
      companyId: produto.companyId,
      storeId: loja.id,
      productId: produto.id,
      quantity: 0,
    });
  }
}

console.log(`${produtos.length} peças × ${lojas.length} lojas = ${produtos.length * lojas.length} saldos.`);
for (const loja of lojas) console.log(`  ${loja.name}`);
console.log(`\nFaltam criar: ${aCriar.length}`);

if (conferir) {
  console.log("\n(--conferir: nada foi alterado)");
  await prisma.$disconnect();
  process.exit(0);
}

if (aCriar.length > 0) {
  // Em blocos: um insert único de milhares de linhas estoura o limite de
  // parâmetros do driver.
  const BLOCO = 500;
  let criados = 0;

  for (let i = 0; i < aCriar.length; i += BLOCO) {
    const parte = aCriar.slice(i, i + BLOCO);
    const feito = await prisma.stockItem.createMany({ data: parte, skipDuplicates: true });
    criados += feito.count;
    process.stdout.write(`\r  criando saldos... ${criados}/${aCriar.length}`);
  }

  console.log(`\n\nCriados ${criados} saldos em zero.`);
} else {
  console.log("\nNada a criar — todas as peças já têm saldo em todas as lojas.");
}

const visiveis = await prisma.stockItem.count({
  where: { product: { deletedAt: null }, store: { deletedAt: null } },
});

console.log(`A tela de Estoque passa a listar ${visiveis} linhas, prontas para a contagem.`);

await prisma.$disconnect();
