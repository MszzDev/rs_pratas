/**
 * O e-mail do comprovante saiu, ou nem foi tentado?
 *
 * São situações diferentes com consertos diferentes, e da tela as duas parecem
 * iguais: "não chegou". Aqui dá para separar — se não há venda, o problema é
 * antes; se há venda sem cliente, o envio nem começa; se há tentativa com
 * `enviado: false`, o problema é a configuração de e-mail.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

function conexao() {
  const caminho = join(process.cwd(), "..", "..", ".env.backup");
  const b = readFileSync(caminho);
  const t = b.toString(b[0] === 0xff && b[1] === 0xfe ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
  return /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(t)[1].trim().replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({ datasources: { db: { url: conexao() } } });

const vendas = await prisma.sale.findMany({
  select: {
    code: true,
    status: true,
    createdAt: true,
    customer: { select: { name: true, email: true } },
    items: { select: { id: true, productName: true, warranty: { select: { code: true } } } },
  },
  orderBy: { createdAt: "desc" },
  take: 5,
});

console.log(`\n=== VENDAS (as 5 mais recentes de ${await prisma.sale.count()}) ===\n`);

if (vendas.length === 0) {
  console.log("  NENHUMA venda no sistema. Sem venda, não há comprovante para sair.");
}

for (const v of vendas) {
  const cliente = v.customer
    ? `${v.customer.name} <${v.customer.email ?? "SEM E-MAIL"}>`
    : "SEM CLIENTE VINCULADO";
  console.log(`  ${v.code}  ${v.createdAt.toLocaleString("pt-BR")}  ${v.status}`);
  console.log(`      cliente: ${cliente}`);
  for (const i of v.items) {
    console.log(`      peça: ${i.productName} — garantia: ${i.warranty?.code ?? "NÃO EMITIDA"}`);
  }
}

console.log(`\n=== GARANTIAS NO SISTEMA: ${await prisma.warranty.count()} ===`);

const tentativas = await prisma.auditLog.findMany({
  where: { reason: { contains: "e-mail" } },
  select: { createdAt: true, action: true, reason: true, metadata: true },
  orderBy: { createdAt: "desc" },
  take: 10,
});

console.log(`\n=== TENTATIVAS DE ENVIO REGISTRADAS: ${tentativas.length} ===\n`);
for (const t of tentativas) {
  console.log(`  ${t.createdAt.toLocaleString("pt-BR")}  ${t.action}  ${t.reason}`);
  console.log(`      ${JSON.stringify(t.metadata)}`);
}

await prisma.$disconnect();
