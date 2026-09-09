/**
 * Escolhe qual modelo de etiqueta é o padrão da empresa.
 *
 * O padrão é o que sai quando ninguém escolhe, e por isso ele tem que casar com
 * o rolo que está **fisicamente na impressora**. Um padrão de 33 × 21 com o rolo
 * de 90 × 12 carregado imprime o desenho errado no papel errado, e quem clicou
 * não fez nada de errado — só não sabia que precisava escolher.
 *
 * Trocar o rolo, então, pede trocar o padrão junto. É o que este script faz em
 * um comando, e é o mesmo que o botão "Tornar padrão" faz na tela.
 *
 * Uso: node scripts/modelo-padrao.mjs ET0002 [--aplicar]
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

const codigo = process.argv[2];
const aplicar = process.argv.includes("--aplicar");

const modelos = await prisma.labelTemplate.findMany({
  where: { deletedAt: null },
  select: { id: true, code: true, name: true, widthMm: true, heightMm: true, isDefault: true },
  orderBy: { code: "asc" },
});

console.log("=== MODELOS ===\n");
for (const m of modelos) {
  console.log(
    `  ${m.code.padEnd(8)} ${m.name.padEnd(38)} ${m.widthMm}x${m.heightMm}mm` +
      (m.isDefault ? "  <- padrão" : ""),
  );
}

if (!codigo) {
  console.log("\nUso: node scripts/modelo-padrao.mjs <código> --aplicar");
  await prisma.$disconnect();
  process.exit(0);
}

const escolhido = modelos.find((m) => m.code === codigo);

if (!escolhido) {
  console.log(`\nNão achei o modelo ${codigo}.`);
  await prisma.$disconnect();
  process.exit(1);
}

if (escolhido.isDefault) {
  console.log(`\n${escolhido.code} já é o padrão.`);
} else if (aplicar) {
  // Numa transação: dois padrões ao mesmo tempo fariam a fila escolher um deles
  // sem critério, e o erro só apareceria no papel.
  await prisma.$transaction(async (tx) => {
    await tx.labelTemplate.updateMany({
      where: { companyId: undefined, isDefault: true },
      data: { isDefault: false },
    });
    await tx.labelTemplate.update({ where: { id: escolhido.id }, data: { isDefault: true } });
  });

  console.log(`\n${escolhido.code} "${escolhido.name}" agora é o padrão.`);
} else {
  console.log(`\n${escolhido.code} viraria o padrão. Rode com --aplicar para gravar.`);
}

await prisma.$disconnect();
