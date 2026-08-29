/**
 * Zera o movimento do período de teste, antes de a loja entrar em operação.
 *
 *   node scripts/zerar-movimento.mjs --conferir    diz o que faria, sem fazer
 *   node scripts/zerar-movimento.mjs --apagar      apaga de verdade
 *
 * Por que existe: o sistema entra em vigor numa segunda-feira, e as vendas,
 * caixas e marcações dos dias de teste ficariam somadas ao primeiro mês de
 * verdade. Relatório de faturamento com venda que não existiu é pior que
 * relatório nenhum — o dono toma decisão em cima dele.
 *
 * O QUE NÃO É APAGADO
 *
 * A AUDITORIA fica. Ela não aparece em relatório e não afeta número nenhum; é
 * o registro de quem fez o quê, e é o que permite descobrir meses depois quem
 * alterou um preço. Apagá-la para "limpar o mês" seria destruir a única coisa
 * que não atrapalha o mês.
 *
 * O CADASTRO fica: lojas, funcionários, produtos, saldos de estoque, clientes,
 * tablets, maquininhas. É o que a loja é, não o que ela fez.
 *
 * AS TRAVAS DO BANCO
 *
 * Seis destas tabelas são append-only por trigger — venda, pagamento, caixa,
 * estoque, ponto. A trava existe para que nem a aplicação nem o dono consigam
 * reescrever histórico, e é justamente por isso que este script precisa
 * desligá-la explicitamente para trabalhar.
 *
 * Ela é desligada e religada DENTRO da mesma transação, com `DISABLE TRIGGER
 * USER` em vez de apagar e recriar: assim, se qualquer coisa falhar no meio, o
 * banco desfaz tudo e as travas voltam sozinhas. Recriar trigger à mão depois
 * de um erro é como se perde a proteção para sempre.
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
if (modo !== "--conferir" && modo !== "--apagar") {
  console.error("Use --conferir para ver o que seria apagado, ou --apagar para apagar.");
  process.exit(1);
}

const url = conexaoGuardada();
const prisma = new PrismaClient({ datasources: { db: { url } } });
const alvo = new URL(url);

console.log(`Banco: ${alvo.host}${alvo.pathname}`);
console.log(modo === "--conferir" ? "Modo: ENSAIO (nada será alterado)\n" : "Modo: APAGANDO\n");

/**
 * As tabelas cujas travas precisam sair do caminho.
 *
 * `audit_logs` NÃO está aqui, e é o ponto principal: a auditoria continua
 * protegida enquanto tudo o mais é apagado — inclusive contra este script.
 */
const TRAVADAS = [
  "sale_return_items",
  "sale_payments",
  "sale_items",
  "cash_movements",
  "stock_movements",
  "time_clock_entries",
];

/**
 * A ordem importa: filho antes de pai, senão a chave estrangeira recusa.
 *
 * Escrita à mão em vez de deduzida porque o banco tem quase noventa tabelas e
 * uma dedução errada aqui apagaria a coisa errada em produção.
 */
/**
 * A ordem importa: filho antes de pai, senão a chave estrangeira recusa.
 *
 * Escrita à mão em vez de deduzida porque o banco tem quase noventa tabelas e
 * uma dedução errada aqui apagaria a coisa errada em produção.
 *
 * Cada linha RECEBE o cliente da transação. Na primeira versão elas usavam o
 * cliente global, e o efeito foi silencioso e feio: as travas eram desligadas
 * dentro da transação, mas os deletes saíam por outra conexão, onde elas
 * continuavam valendo. As tabelas sem trava foram apagadas e confirmadas na
 * hora — fora da transação, portanto sem volta — e a primeira protegida
 * recusou. Ficou pela metade, que é exatamente o que a transação existia para
 * impedir.
 */
const ORDEM = [
  ["Fila de impressão", (tx) => tx.printJob.deleteMany({})],
  ["Acionamentos de garantia", (tx) => tx.warrantyClaim.deleteMany({})],
  ["Garantias", (tx) => tx.warranty.deleteMany({})],
  ["Certificados", (tx) => tx.certificate.deleteMany({})],
  ["Itens de devolução", (tx) => tx.saleReturnItem.deleteMany({})],
  ["Devoluções", (tx) => tx.saleReturn.deleteMany({})],
  ["Pagamentos", (tx) => tx.salePayment.deleteMany({})],
  ["Itens de venda", (tx) => tx.saleItem.deleteMany({})],
  ["Vendas", (tx) => tx.sale.deleteMany({})],
  ["Itens de orçamento", (tx) => tx.quoteItem.deleteMany({})],
  ["Orçamentos", (tx) => tx.quote.deleteMany({})],
  ["Reservas", (tx) => tx.reservation.deleteMany({})],
  ["Solicitações de peça", (tx) => tx.pieceRequest.deleteMany({})],
  ["Ordens de serviço", (tx) => tx.serviceOrder.deleteMany({})],
  ["Movimentos de caixa", (tx) => tx.cashMovement.deleteMany({})],
  ["Sessões de caixa", (tx) => tx.cashSession.deleteMany({})],
  ["Itens de transferência", (tx) => tx.stockTransferItem.deleteMany({})],
  ["Transferências", (tx) => tx.stockTransfer.deleteMany({})],
  ["Contagens (linhas)", (tx) => tx.inventoryCount.deleteMany({})],
  ["Contagens", (tx) => tx.inventory.deleteMany({})],
  ["Movimentos de estoque", (tx) => tx.stockMovement.deleteMany({})],
  ["Marcações de ponto", (tx) => tx.timeClockEntry.deleteMany({})],
  /**
   * Os clientes saem por último, e só depois de tudo que aponta para eles.
   *
   * Eles são cadastro, não movimento — mas os que existem hoje foram criados
   * nos testes, com nome e telefone inventados. Entrar em operação com eles faz
   * a vendedora achar que já conhece a cliente do balcão e vincular a venda à
   * pessoa errada.
   */
  ["Clientes", (tx) => tx.customer.deleteMany({})],
];

if (modo === "--conferir") {
  const contagens = {
    "Fila de impressão": await prisma.printJob.count(),
    Garantias: await prisma.warranty.count(),
    Certificados: await prisma.certificate.count(),
    Devoluções: await prisma.saleReturn.count(),
    Pagamentos: await prisma.salePayment.count(),
    "Itens de venda": await prisma.saleItem.count(),
    Vendas: await prisma.sale.count(),
    Orçamentos: await prisma.quote.count(),
    Reservas: await prisma.reservation.count(),
    "Solicitações de peça": await prisma.pieceRequest.count(),
    "Ordens de serviço": await prisma.serviceOrder.count(),
    "Movimentos de caixa": await prisma.cashMovement.count(),
    "Sessões de caixa": await prisma.cashSession.count(),
    Transferências: await prisma.stockTransfer.count(),
    Contagens: await prisma.inventory.count(),
    "Movimentos de estoque": await prisma.stockMovement.count(),
    "Marcações de ponto": await prisma.timeClockEntry.count(),
    Clientes: await prisma.customer.count(),
  };

  let total = 0;
  for (const [nome, quantos] of Object.entries(contagens)) {
    total += quantos;
    if (quantos > 0) console.log(`${String(quantos).padStart(7)}  ${nome}`);
  }

  console.log(`${String(total).padStart(7)}  seriam apagados\n`);
  console.log(`${String(await prisma.auditLog.count()).padStart(7)}  registros de auditoria PRESERVADOS`);
  console.log(`${String(await prisma.product.count()).padStart(7)}  produtos preservados`);
  console.log(`${String(await prisma.stockItem.count()).padStart(7)}  saldos de estoque preservados`);
  console.log(`${String(await prisma.user.count()).padStart(7)}  funcionários preservados`);

  await prisma.$disconnect();
  process.exit(0);
}

const resultado = await prisma.$transaction(
  async (tx) => {
    for (const tabela of TRAVADAS) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${tabela}" DISABLE TRIGGER USER`);
    }

    const apagados = [];
    for (const [nome, apagar] of ORDEM) {
      const { count } = await apagar(tx).catch((erro) => {
        throw new Error(`falhou em ${nome}: ${erro.message}`);
      });
      if (count > 0) apagados.push(`${String(count).padStart(7)}  ${nome}`);
    }

    for (const tabela of TRAVADAS) {
      await tx.$executeRawUnsafe(`ALTER TABLE "${tabela}" ENABLE TRIGGER USER`);
    }

    return apagados;
  },
  { timeout: 120_000 },
);

console.log(resultado.join("\n") || "nada a apagar");

// Prova que as travas voltaram. Sem esta conferência, um erro silencioso aqui
// deixaria a auditoria e o ponto graváveis — sem ninguém perceber.
const soltas = await prisma.$queryRawUnsafe(`
  SELECT c.relname AS tabela, t.tgname AS trigger
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND t.tgenabled = 'D'
`);

console.log(
  soltas.length === 0
    ? "\nTravas de imutabilidade conferidas: todas ativas."
    : `\nATENÇÃO: travas desligadas: ${JSON.stringify(soltas)}`,
);

console.log(`Auditoria preservada: ${await prisma.auditLog.count()} registros.`);

await prisma.$disconnect();
