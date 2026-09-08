/**
 * Diz à Nuvemshop qual loja alimenta o site: o Jardim Ângela.
 *
 * A integração estava conectada mas sem loja escolhida, e nesse estado a
 * sincronia se recusa a rodar — de propósito. Publicar o estoque errado é pior
 * que não publicar: a vitrine passaria a vender peça que está noutra unidade e
 * não tem como despachar.
 *
 * A escolha é o Jardim Ângela porque é de lá que as peças vendidas online
 * saem. É decisão do dono, não do sistema, e por isso está escrita aqui e não
 * deduzida em código.
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

const loja = await prisma.store.findFirst({
  where: { code: "JANG", deletedAt: null },
  select: { id: true, name: true },
});

if (!loja) {
  console.log("Loja JANG não encontrada. Nada feito.");
  await prisma.$disconnect();
  process.exit(1);
}

const integracao = await prisma.integration.findFirst({
  where: { provider: "NUVEMSHOP" },
  select: { id: true, status: true, storeId: true },
});

if (!integracao) {
  console.log("Nuvemshop não está configurada. Conecte primeiro em Configurações.");
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`Nuvemshop: ${integracao.status}`);
console.log(`  loja atual: ${integracao.storeId ?? "nenhuma"}`);
console.log(`  loja nova:  ${loja.id}  (${loja.name})`);

if (integracao.storeId === loja.id) {
  console.log("\nJá está ligada ao Jardim Ângela. Nada a fazer.");
} else if (aplicar) {
  await prisma.integration.update({
    where: { id: integracao.id },
    data: { storeId: loja.id },
  });
  console.log(`\nLigada: o site passa a publicar o estoque da ${loja.name}.`);
} else {
  console.log("\nRode de novo com --aplicar para gravar.");
}

await prisma.$disconnect();
