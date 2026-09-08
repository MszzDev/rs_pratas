/**
 * O retrato da operação: o que já foi usado de verdade e o que está parado.
 *
 * Serve para responder "o que falta?" com dados em vez de memória. Um módulo
 * pode estar pronto no código e nunca ter sido usado na loja — e é isso, e não
 * a lista de funcionalidades, que diz onde o sistema realmente está.
 *
 * É só leitura.
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

const contagens = [
  ["Lojas", () => prisma.store.count({ where: { deletedAt: null } })],
  ["Funcionários", () => prisma.user.count({ where: { deletedAt: null } })],
  ["Tablets pareados", () => prisma.device.count({ where: { deletedAt: null, status: "ACTIVE" } })],
  ["Maquininhas", () => prisma.paymentTerminal.count({ where: { deletedAt: null } })],
  ["Produtos", () => prisma.product.count({ where: { deletedAt: null } })],
  ["Clientes", () => prisma.customer.count({ where: { deletedAt: null } })],
  ["VENDAS", () => prisma.sale.count()],
  ["Movimentos de estoque", () => prisma.stockMovement.count()],
  ["Aberturas de caixa", () => prisma.cashSession.count()],
  ["Marcações de ponto", () => prisma.timeClockEntry.count()],
  ["Jornadas cadastradas", () => prisma.workSchedule.count({ where: { isActive: true } })],
  ["Etiquetas impressas", () => prisma.printJob.count()],
];

console.log("=== A OPERAÇÃO EM NÚMEROS ===\n");

for (const [rotulo, contar] of contagens) {
  try {
    const n = await contar();
    const marca = n === 0 ? "  <-- ZERO" : "";
    console.log(`  ${rotulo.padEnd(24)} ${String(n).padStart(6)}${marca}`);
  } catch (erro) {
    console.log(`  ${rotulo.padEnd(24)} (erro: ${erro.message.split("\n")[0]})`);
  }
}

await prisma.$disconnect();
