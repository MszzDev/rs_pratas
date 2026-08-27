#!/usr/bin/env node
/**
 * Remove contas pela matrícula, com a mesma regra da tela.
 *
 *   cd apps/api
 *   node scripts/remover-contas.mjs --conferir RS000200 RS000300
 *   node scripts/remover-contas.mjs RS000200 RS000300
 *
 * Existe para as contas de demonstração, que nasceram junto com o sistema e
 * ficaram: enquanto existem, são acessos ao sistema real sem dono.
 *
 * A regra é a do resto do sistema, e não uma exceção de script: quem nunca
 * encostou em nada some de vez; quem tem ponto, venda, caixa, movimentação de
 * estoque ou auditoria é DESATIVADO. Para funcionário isso não é escolha de
 * projeto — é o que a lei manda guardar depois da saída.
 *
 * O ato fica na auditoria mesmo quando a pessoa some. É o que responde, meses
 * depois, "existia uma matrícula RS000300 aqui?".
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function conexaoGuardada() {
  const caminho = join(process.cwd(), "..", "..", ".env.backup");
  if (!existsSync(caminho)) return null;

  const bruto = readFileSync(caminho);
  const utf16 = bruto[0] === 0xff && bruto[1] === 0xfe;
  const texto = bruto.toString(utf16 ? "utf16le" : "utf8").replace(/^﻿/, "");

  for (const linha of texto.split(/\r?\n/)) {
    const achou = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+)$/.exec(linha);
    if (achou) return achou[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const argumentos = process.argv.slice(2);
const conferir = argumentos.includes("--conferir");
const matriculas = argumentos.filter((a) => !a.startsWith("--"));

if (matriculas.length === 0) {
  console.error("Informe as matrículas. Ex.: node scripts/remover-contas.mjs --conferir RS000200");
  process.exit(1);
}

const url = process.env.DATABASE_URL ?? conexaoGuardada();

if (!url) {
  console.error("Informe DATABASE_URL ou grave a conexão em ../../.env.backup.");
  process.exit(1);
}

const alvo = new URL(url);
console.log(`Banco: ${alvo.hostname}${alvo.pathname}\n`);

const prisma = new PrismaClient({ datasources: { db: { url } } });

for (const matricula of matriculas) {
  const user = await prisma.user.findFirst({
    where: { employeeCode: { equals: matricula, mode: "insensitive" }, deletedAt: null },
  });

  if (!user) {
    console.log(`${matricula}: não encontrada (ou já removida)\n`);
    continue;
  }

  const [ponto, vendas, caixaAberto, caixaFechado, movimentos, auditoria] = await Promise.all([
    prisma.timeClockEntry.count({ where: { userId: user.id } }),
    prisma.sale.count({ where: { sellerId: user.id } }),
    prisma.cashSession.count({ where: { openedById: user.id } }),
    prisma.cashSession.count({ where: { closedById: user.id } }),
    prisma.stockMovement.count({ where: { userId: user.id } }),
    prisma.auditLog.count({ where: { userId: user.id } }),
  ]);

  const historico = ponto + vendas + caixaAberto + caixaFechado + movimentos + auditoria;

  console.log(`${matricula} — ${user.name} (${user.role})`);
  console.log(
    `  ponto ${ponto} · vendas ${vendas} · caixas ${caixaAberto + caixaFechado} ` +
      `· movimentos ${movimentos} · auditoria ${auditoria}`,
  );
  console.log(`  ${historico > 0 ? "SERÁ DESATIVADA (tem histórico)" : "SERÁ APAGADA"}\n`);

  if (conferir) continue;

  if (historico > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "INACTIVE", deletedAt: new Date() },
    });
    await prisma.refreshToken.updateMany({
      where: { session: { userId: user.id }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "conta removida" },
    });
    await prisma.deviceSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "conta removida" },
    });
  } else {
    // De fora para dentro: o banco recusa apagar o que ainda é apontado.
    await prisma.$transaction([
      prisma.refreshToken.deleteMany({ where: { session: { userId: user.id } } }),
      prisma.stepUpToken.deleteMany({ where: { userId: user.id } }),
      prisma.deviceSession.deleteMany({ where: { userId: user.id } }),
      prisma.uploadLink.deleteMany({ where: { userId: user.id } }),
      prisma.userPermission.deleteMany({ where: { userId: user.id } }),
      prisma.userPermission.deleteMany({ where: { grantedById: user.id } }),
      prisma.workSchedule.deleteMany({ where: { userId: user.id } }),
      prisma.workSchedule.deleteMany({ where: { createdById: user.id } }),
      prisma.pinResetRequest.deleteMany({ where: { userId: user.id } }),
      prisma.employeeDocument.deleteMany({ where: { userId: user.id } }),
      prisma.twoFactorCredential.deleteMany({ where: { userId: user.id } }),
      prisma.userStore.deleteMany({ where: { userId: user.id } }),
      prisma.user.delete({ where: { id: user.id } }),
    ]);
  }

  /**
   * O registro do ato, gravado DEPOIS.
   *
   * Antes, a própria linha de auditoria criaria a menção que impede apagar —
   * `audit_logs.userId` aponta para o usuário, e o banco recusa remover quem
   * ainda é referenciado.
   *
   * `userId` fica nulo porque quem executou foi um script de manutenção, e
   * não uma pessoa dentro do sistema. Inventar um autor seria pior que dizer
   * a verdade no motivo.
   */
  await prisma.auditLog.create({
    data: {
      companyId: user.companyId,
      action: "USER_BLOCK",
      result: "SUCCESS",
      entityType: "User",
      entityId: user.id,
      previousData: { name: user.name, employeeCode: user.employeeCode, role: user.role },
      newData: { removido: historico > 0 ? "desativado" : "apagado" },
      reason: "conta de demonstração removida por manutenção",
    },
  });
}

if (conferir) console.log("(--conferir: nada foi alterado)");

await prisma.$disconnect();
