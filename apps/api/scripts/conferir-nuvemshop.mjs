/**
 * A sincronia com a Nuvemshop está funcionando de verdade?
 *
 * "Conectada" na tela só quer dizer que o token vale. O que importa é se os
 * códigos batem: o sistema publica o estoque procurando o produto do site pelo
 * SKU, e um código que existe de um lado e não do outro é uma peça que nunca
 * vai sincronizar — em silêncio, porque não é erro de ninguém.
 *
 * Este script compara os dois lados e diz quantas peças casam. É só leitura:
 * não publica nada, não baixa estoque, não toca no site.
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

const integracao = await prisma.integration.findFirst({
  where: { provider: "NUVEMSHOP" },
  select: { status: true, storeId: true, lastSyncAt: true, lastOrderSyncAt: true },
});

if (!integracao) {
  console.log("Nuvemshop não configurada.");
  await prisma.$disconnect();
  process.exit(0);
}

const loja = integracao.storeId
  ? await prisma.store.findUnique({
      where: { id: integracao.storeId },
      select: { code: true, name: true },
    })
  : null;

console.log("=== A LIGAÇÃO ===\n");
console.log(`  situação:            ${integracao.status}`);
console.log(`  loja que alimenta:   ${loja ? loja.name : "NENHUMA"}`);
console.log(`  estoque publicado:   ${integracao.lastSyncAt?.toLocaleString("pt-BR") ?? "NUNCA"}`);
console.log(`  pedidos lidos:       ${integracao.lastOrderSyncAt?.toLocaleString("pt-BR") ?? "NUNCA"}`);

if (!integracao.storeId) {
  console.log("\nSem loja escolhida, a sincronia se recusa a rodar.");
  await prisma.$disconnect();
  process.exit(0);
}

/**
 * Os produtos são da EMPRESA; o estoque é da loja.
 *
 * É essa separação que a operação real exige: as cinco lojas vendem as mesmas
 * peças, mas só o Jardim Ângela alimenta o site.
 */
const produtos = await prisma.product.count({ where: { deletedAt: null } });
const variacoes = await prisma.productVariation.count({ where: { product: { deletedAt: null } } });

const estoqueDaLoja = await prisma.stockItem.findMany({
  where: { storeId: integracao.storeId, product: { deletedAt: null } },
  select: {
    quantity: true,
    reservedQuantity: true,
    product: { select: { sku: true } },
    variation: { select: { sku: true } },
  },
});

const comSaldo = estoqueDaLoja.filter((i) => i.quantity - i.reservedQuantity > 0);

console.log("\n=== O QUE HÁ PARA PUBLICAR ===\n");
console.log(`  produtos cadastrados (todas as lojas): ${produtos}`);
console.log(`  variações:                             ${variacoes}`);
console.log(`  linhas de estoque em ${loja?.code}:${" ".repeat(Math.max(0, 20 - (loja?.code.length ?? 0)))}${estoqueDaLoja.length}`);
console.log(`  dessas, com saldo disponível:          ${comSaldo.length}`);

if (estoqueDaLoja.length === 0) {
  console.log("\nA loja que alimenta o site não tem NENHUMA linha de estoque.");
  console.log("Publicar agora zeraria tudo no site — o estoque é dela, não da rede.");
}

const nossos = new Set(
  estoqueDaLoja.map((i) => i.variation?.sku ?? i.product.sku).filter(Boolean),
);

console.log(`\n  códigos distintos no estoque da loja:   ${nossos.size}`);
console.log("\nPara comparar com os códigos do site, use o botão");
console.log('"Enviar estoque" em Configurações → Integrações: ele responde');
console.log("quantas variações atualizou e quais códigos existem lá e não aqui.");

await prisma.$disconnect();
