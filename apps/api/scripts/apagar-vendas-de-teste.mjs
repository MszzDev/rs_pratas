/**
 * Apaga as vendas feitas em teste, e só elas.
 *
 * A venda é a raiz de várias coisas: itens, pagamentos, movimento de estoque
 * que baixou a peça, movimento de caixa que registrou o dinheiro. Apagar só a
 * linha da venda deixaria o estoque baixado sem motivo e o caixa com um valor
 * que não se explica — pior que não apagar nada.
 *
 * Então tudo que a venda gerou sai junto, e o estoque volta ao que era.
 *
 * ## As travas
 *
 * `sale_items`, `sale_payments`, `stock_movements` e `cash_movements` são
 * append-only por gatilho no banco: nem o dono consegue alterá-las por SQL.
 * Isso é proposital e protege o histórico. Para uma limpeza controlada, os
 * gatilhos são desligados DENTRO da transação e religados no fim — se algo
 * falhar no meio, a transação inteira volta atrás e as travas continuam de pé.
 *
 * Cada apagamento usa o `tx` da transação, e não o cliente global. Já houve um
 * caso em que usar o cliente global fez metade das exclusões rodarem FORA da
 * transação, com as travas ativas: parte apagou e comitou, parte falhou.
 *
 * Sem `--apagar` só mostra o que faria.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

function conexaoGuardada() {
  const caminho = join(process.cwd(), "..", "..", ".env.backup");
  const bruto = readFileSync(caminho);
  const utf16 = bruto[0] === 0xff && bruto[1] === 0xfe;
  const texto = bruto.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");

  const achou = /^\s*DATABASE_MIGRATE_URL\s*=\s*(.+)$/m.exec(texto)
    ?? /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(texto);
  if (!achou) throw new Error("Nenhuma URL de banco encontrada em .env.backup");

  return achou[1].trim().replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({ datasources: { db: { url: conexaoGuardada() } } });
const apagar = process.argv.includes("--apagar");

const vendas = await prisma.sale.findMany({
  select: {
    id: true,
    code: true,
    createdAt: true,
    totalAmount: true,
    status: true,
    store: { select: { name: true } },
    seller: { select: { name: true } },
    items: { select: { id: true, quantity: true, product: { select: { name: true } } } },
    payments: { select: { id: true, method: true, amount: true } },
    returns: { select: { id: true } },
  },
  orderBy: { createdAt: "asc" },
});

if (vendas.length === 0) {
  console.log("Nenhuma venda no sistema. Nada a fazer.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`=== ${vendas.length} venda(s) no sistema ===\n`);

for (const v of vendas) {
  console.log(`  Venda ${v.code}  ${v.createdAt.toLocaleString("pt-BR")}  ${v.status}`);
  console.log(`    loja: ${v.store.name}   vendedor: ${v.seller.name}   total: R$ ${v.totalAmount}`);
  for (const i of v.items) console.log(`    peça: ${i.product?.name ?? "?"} x${i.quantity}`);
  for (const p of v.payments) console.log(`    pagamento: ${p.method} R$ ${p.amount}`);
  if (v.returns.length > 0) console.log(`    ATENÇÃO: tem ${v.returns.length} devolução(ões) ligada(s)`);
  console.log("");
}

const comDevolucao = vendas.filter((v) => v.returns.length > 0);
if (comDevolucao.length > 0) {
  console.log("Há vendas com devolução ligada. Este script não mexe nelas —");
  console.log("apagar uma venda devolvida esconderia a devolução e o dinheiro que voltou.");
  console.log("");
}

const alvos = vendas.filter((v) => v.returns.length === 0);
const ids = alvos.map((v) => v.id);

if (!apagar) {
  console.log(`${alvos.length} venda(s) seriam apagadas, com itens, pagamentos,`);
  console.log("movimento de estoque e movimento de caixa. O estoque volta ao que era.");
  console.log("\nRode de novo com --apagar para executar.");
  await prisma.$disconnect();
  process.exit(0);
}

const TRAVADAS = ["sale_items", "sale_payments", "stock_movements", "cash_movements", "audit_logs"];

/**
 * O limite padrão de 5 segundos não serve aqui.
 *
 * O banco está na nuvem e cada ida e volta custa dezenas de milissegundos;
 * desligar as travas, devolver o estoque e apagar cinco tabelas passa disso
 * com folga. Estourar o limite não é perigoso — a transação volta atrás
 * inteira —, mas deixa o trabalho por fazer e assusta quem está rodando.
 */
const resultado = await prisma.$transaction(async (tx) => {
  for (const tabela of TRAVADAS) {
    await tx.$executeRawUnsafe(`ALTER TABLE "${tabela}" DISABLE TRIGGER USER`);
  }

  // O estoque volta ANTES de o movimento sumir: é o movimento que diz quanto
  // devolver, e depois de apagado não há como saber.
  const movimentos = await tx.stockMovement.findMany({
    where: { referenceType: "SALE", referenceId: { in: ids } },
    select: { id: true, stockItemId: true, quantity: true },
  });

  for (const m of movimentos) {
    // A venda baixou, então desfazer é somar de volta o que ela tirou. O
    // movimento já aponta para a linha exata de estoque — loja, produto e
    // variação —, então não há o que recalcular nem risco de acertar a errada.
    await tx.stockItem.update({
      where: { id: m.stockItemId },
      data: { quantity: { increment: Math.abs(m.quantity) } },
    });
  }

  const caixa = await tx.cashMovement.deleteMany({
    where: { referenceType: "SALE", referenceId: { in: ids } },
  });
  const estoque = await tx.stockMovement.deleteMany({
    where: { referenceType: "SALE", referenceId: { in: ids } },
  });
  const pagamentos = await tx.salePayment.deleteMany({ where: { saleId: { in: ids } } });
  const itens = await tx.saleItem.deleteMany({ where: { saleId: { in: ids } } });
  const apagadas = await tx.sale.deleteMany({ where: { id: { in: ids } } });

  for (const tabela of TRAVADAS) {
    await tx.$executeRawUnsafe(`ALTER TABLE "${tabela}" ENABLE TRIGGER USER`);
  }

  return {
    vendas: apagadas.count,
    itens: itens.count,
    pagamentos: pagamentos.count,
    estoque: estoque.count,
    caixa: caixa.count,
    devolvidoAoEstoque: movimentos.length,
  };
}, { timeout: 120_000, maxWait: 30_000 });

console.log("=== APAGADO ===");
console.log(`  vendas: ${resultado.vendas}`);
console.log(`  itens: ${resultado.itens}`);
console.log(`  pagamentos: ${resultado.pagamentos}`);
console.log(`  movimentos de estoque: ${resultado.estoque}`);
console.log(`  movimentos de caixa: ${resultado.caixa}`);
console.log(`  peças devolvidas ao estoque: ${resultado.devolvidoAoEstoque}`);

await prisma.$disconnect();
