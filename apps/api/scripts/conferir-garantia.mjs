/**
 * A decisão de emitir garantia, conferida contra o banco de verdade.
 *
 * O caminho até aqui já está provado: o comprovante das vendas novas saiu com
 * `enviado: true`, e quem manda esse e-mail é a MESMA função que emite a
 * garantia — ela chama a emissão antes de olhar o e-mail do cliente. Se o
 * e-mail sai, a emissão foi chamada.
 *
 * O que falhava era só a decisão de QUANTOS meses, e é ela que este script
 * refaz com a regra corrigida, lendo a configuração real da empresa.
 *
 * Com `--aplicar`, emite as garantias que faltaram nas vendas já concluídas.
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

const APLICAR = process.argv.includes("--aplicar");
const MESES_PADRAO = 3;
const TERMOS_PADRAO =
  "Garantia contra defeito de fabricação. Não cobre mau uso, batidas, contato " +
  "com produtos químicos, nem escurecimento natural da prata, que é reversível " +
  "com limpeza. Apresente este documento e o comprovante de compra.";

const prisma = new PrismaClient({ datasources: { db: { url: conexao() } } });

const empresa = await prisma.company.findFirstOrThrow({ select: { id: true, tradeName: true } });

async function configuracao(chave) {
  const guardado = await prisma.appSetting.findFirst({ where: { companyId: empresa.id, key: chave } });
  if (guardado?.value === undefined || guardado.value === null) return null;
  const texto = String(guardado.value).trim();
  return texto.length > 0 ? texto : null;
}

const configurado = await configuracao("warranty_months");

console.log(`\n=== A DECISÃO ===\n`);
console.log(`  warranty_months guardado: ${configurado === null ? "NADA (nunca preenchido)" : configurado}`);

// A regra ANTIGA, que era o defeito: Number(null) vira zero e desliga tudo.
const comoEra = Number(configurado) === 0 ? "não emite nada" : `${Number(configurado)} meses`;

let meses = MESES_PADRAO;
let desligado = false;
if (configurado !== null) {
  const escolhido = Number(configurado);
  if (escolhido === 0) desligado = true;
  else if (Number.isInteger(escolhido) && escolhido > 0) meses = escolhido;
}

console.log(`  regra ANTIGA decidiria:   ${comoEra}`);
console.log(`  regra NOVA decide:        ${desligado ? "não emite (zero explícito)" : `${meses} meses`}`);

if (desligado) {
  await prisma.$disconnect();
  process.exit(0);
}

const termos = (await configuracao("warranty_terms")) ?? TERMOS_PADRAO;

const itensSemGarantia = await prisma.saleItem.findMany({
  where: { warranty: null, sale: { status: "CONCLUIDA", companyId: empresa.id } },
  select: {
    id: true,
    productName: true,
    sale: { select: { code: true, completedAt: true, createdAt: true, storeId: true } },
  },
  orderBy: { sale: { code: "asc" } },
});

console.log(`\n=== PEÇAS VENDIDAS SEM GARANTIA: ${itensSemGarantia.length} ===\n`);

for (const item of itensSemGarantia) {
  const inicio = item.sale.completedAt ?? item.sale.createdAt;
  const fim = new Date(inicio);
  fim.setMonth(fim.getMonth() + meses);
  console.log(`  ${item.sale.code}  ${item.productName}  →  vale até ${fim.toLocaleDateString("pt-BR")}`);
}

if (!APLICAR) {
  console.log(`\n  (simulação — rode com --aplicar para emitir as que faltaram)\n`);
  await prisma.$disconnect();
  process.exit(0);
}

const dono = await prisma.user.findFirstOrThrow({
  where: { role: "DONO", deletedAt: null },
  select: { id: true },
});

let emitidas = 0;
for (const item of itensSemGarantia) {
  const inicio = item.sale.completedAt ?? item.sale.createdAt;
  const fim = new Date(inicio);
  fim.setMonth(fim.getMonth() + meses);

  const quantas = await prisma.warranty.count({ where: { companyId: empresa.id } });

  await prisma.warranty.create({
    data: {
      companyId: empresa.id,
      saleItemId: item.id,
      code: `GA${String(quantas + 1).padStart(6, "0")}`,
      months: meses,
      startsAt: inicio,
      expiresAt: fim,
      terms: termos,
      createdById: dono.id,
    },
  });
  emitidas += 1;
}

console.log(`\n  >>> ${emitidas} garantia(s) emitida(s) <<<\n`);
await prisma.$disconnect();
