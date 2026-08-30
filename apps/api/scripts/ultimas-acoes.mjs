/**
 * As últimas ações registradas na auditoria.
 *
 * Serve para responder a pergunta que mais aparece quando alguém diz "não
 * funciona": o pedido chegou ao servidor? Se a ação está aqui, chegou e foi
 * processada; se não está, parou antes — rede, sessão ou a própria tela.
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

const quantas = Number(process.argv[2] ?? 20);

const acoes = await prisma.auditLog.findMany({
  orderBy: { createdAt: "desc" },
  take: quantas,
  select: {
    createdAt: true,
    action: true,
    result: true,
    entityType: true,
    reason: true,
    userRoleSnapshot: true,
    user: { select: { name: true, employeeCode: true } },
  },
});

for (const a of acoes) {
  const quem = a.user ? `${a.user.employeeCode} ${a.user.name}` : "—";
  const falhou = a.result !== "SUCCESS" ? `  [${a.result}]` : "";

  console.log(
    `${a.createdAt.toLocaleString("pt-BR")}  ${a.action}${falhou}  ${quem}` +
      (a.reason ? `  · ${a.reason}` : ""),
  );
}

console.log(`\n${acoes.length} registros. Nada aqui = o pedido não chegou ao servidor.`);

await prisma.$disconnect();
