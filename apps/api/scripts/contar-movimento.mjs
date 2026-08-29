/**
 * Conta o que existe de movimento no banco, sem tocar em nada.
 *
 * Serve para decidir o que apagar antes de a loja entrar em operação: os
 * números do período de teste não podem se misturar aos do primeiro mês de
 * verdade. É SÓ LEITURA — nenhuma linha é alterada aqui.
 *
 * A conexão vem de `.env.backup`, a mesma que a rotina de cópia usa, para não
 * haver dois lugares guardando o endereço do banco da loja.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

function conexaoGuardada() {
  const caminho = join(process.cwd(), "..", "..", ".env.backup");
  const bruto = readFileSync(caminho);

  // O arquivo pode ter sido salvo em UTF-16 pelo PowerShell, e aí o texto vem
  // com um byte nulo entre cada letra — o que faz a expressão abaixo não achar
  // nada, sem erro nenhum.
  const utf16 = bruto[0] === 0xff && bruto[1] === 0xfe;
  const texto = bruto.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");

  const achou = /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(texto);
  if (!achou) throw new Error("DATABASE_URL não encontrada em .env.backup");

  return achou[1].trim().replace(/^["']|["']$/g, "");
}

const url = conexaoGuardada();
const prisma = new PrismaClient({ datasources: { db: { url } } });

const alvo = new URL(url);
console.log(`Banco: ${alvo.host}${alvo.pathname}\n`);

/**
 * Separado em dois grupos porque a decisão sobre eles é diferente.
 *
 * O MOVIMENTO é o que aconteceu — venda, caixa, ponto. É o que polui o
 * primeiro mês. O CADASTRO é o que a loja é — produtos, lojas, gente. Apagar
 * cadastro seria começar do zero, e não é isso que se pediu.
 */
const MOVIMENTO = {
  "Vendas": () => prisma.sale.count(),
  "  itens de venda": () => prisma.saleItem.count(),
  "  pagamentos": () => prisma.salePayment.count(),
  "Devoluções/trocas": () => prisma.saleReturn.count(),
  "Garantias": () => prisma.warranty.count(),
  "  acionamentos": () => prisma.warrantyClaim.count(),
  "Certificados": () => prisma.certificate.count(),
  "Ordens de serviço": () => prisma.serviceOrder.count(),
  "Orçamentos": () => prisma.quote.count(),
  "Reservas": () => prisma.reservation.count(),
  "Solicitações de peça": () => prisma.pieceRequest.count(),
  "Caixas (sessões)": () => prisma.cashSession.count(),
  "  movimentos de caixa": () => prisma.cashMovement.count(),
  "Movimentos de estoque": () => prisma.stockMovement.count(),
  "Transferências": () => prisma.stockTransfer.count(),
  "Contagens de estoque": () => prisma.inventory.count(),
  "Marcações de ponto": () => prisma.timeClockEntry.count(),
  "Fila de impressão": () => prisma.printJob.count(),
  "Registros de auditoria": () => prisma.auditLog.count(),
};

const CADASTRO = {
  "Lojas": () => prisma.store.count(),
  "Funcionários": () => prisma.user.count(),
  "Produtos": () => prisma.product.count(),
  "Saldos de estoque": () => prisma.stockItem.count(),
  "Clientes": () => prisma.customer.count(),
  "Tablets": () => prisma.device.count(),
  "Maquininhas": () => prisma.paymentTerminal.count(),
  "Modelos de etiqueta": () => prisma.labelTemplate.count(),
};

async function mostrar(titulo, grupo) {
  console.log(`=== ${titulo} ===`);
  let total = 0;

  for (const [nome, contar] of Object.entries(grupo)) {
    const quantos = await contar();
    total += quantos;
    console.log(`${String(quantos).padStart(7)}  ${nome}`);
  }

  console.log(`${String(total).padStart(7)}  TOTAL\n`);
}

await mostrar("MOVIMENTO (o que se pensa em apagar)", MOVIMENTO);
await mostrar("CADASTRO (o que a loja é — não se apaga)", CADASTRO);

const primeira = await prisma.sale.findFirst({
  orderBy: { createdAt: "asc" },
  select: { createdAt: true, code: true },
});
const ultima = await prisma.sale.findFirst({
  orderBy: { createdAt: "desc" },
  select: { createdAt: true, code: true },
});

if (primeira && ultima) {
  console.log(
    `Vendas de ${primeira.createdAt.toLocaleDateString("pt-BR")} (${primeira.code}) ` +
      `até ${ultima.createdAt.toLocaleDateString("pt-BR")} (${ultima.code}).`,
  );
}

await prisma.$disconnect();
