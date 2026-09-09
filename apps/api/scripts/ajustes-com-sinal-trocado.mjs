/**
 * Algum ajuste de estoque foi gravado com o sinal invertido?
 *
 * A lista de movimentos que SOMAM ao saldo não incluía `AJUSTE` nem
 * `INVENTARIO`. Quem chamava esses dois só os usava para diferença positiva —
 * "o saldo certo é 7, e não 3" —, mas o cálculo tratava tudo que não estivesse
 * na lista como saída. Resultado: corrigir para cima subtraía.
 *
 * O código já está corrigido. Este script olha o que ficou gravado ANTES da
 * correção, porque movimento é história: mudar a regra não reescreve o passado,
 * e um saldo que encolheu quando devia crescer continua errado no banco.
 *
 * É só leitura. Não corrige nada.
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

const suspeitos = await prisma.stockMovement.findMany({
  where: { type: { in: ["AJUSTE", "INVENTARIO"] } },
  select: {
    createdAt: true,
    type: true,
    quantity: true,
    quantityBefore: true,
    quantityAfter: true,
    reason: true,
    stockItem: {
      select: {
        store: { select: { name: true } },
        product: { select: { name: true, sku: true } },
      },
    },
  },
  orderBy: { createdAt: "asc" },
});

console.log(`\nMovimentos de AJUSTE/INVENTARIO gravados: ${suspeitos.length}`);

// Sinal negativo nesses dois tipos é a marca do defeito: quem chamava sempre
// queria somar.
const invertidos = suspeitos.filter((m) => m.quantity < 0);

if (invertidos.length === 0) {
  console.log("Nenhum com sinal negativo. Nada foi gravado errado.\n");
} else {
  console.log(`\nCom o sinal trocado (subtraíram quando deviam somar): ${invertidos.length}\n`);
  for (const m of invertidos) {
    const data = m.createdAt.toLocaleString("pt-BR");
    const peca = m.stockItem.product;
    console.log(
      `  ${data}  ${m.stockItem.store.name}  ${peca.sku}  ${peca.name}` +
        `\n      ${m.quantityBefore} -> ${m.quantityAfter} (${m.quantity})  ${m.reason ?? ""}`,
    );
  }
  console.log("");
}

await prisma.$disconnect();
