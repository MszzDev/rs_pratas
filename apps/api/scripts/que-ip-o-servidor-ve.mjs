/**
 * O servidor enxerga o IP de quem chama, ou só o do proxy do Render?
 *
 * Decide se dá para o sistema descobrir sozinho o endereço da casa: se o IP
 * gravado na auditoria for público e variado, é o do aparelho de verdade; se
 * for sempre o mesmo e de faixa interna, o proxy está escondendo a origem e
 * nenhuma detecção automática funcionaria.
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
  if (!achou) throw new Error("DATABASE_URL não encontrada");
  return achou[1].trim().replace(/^["']|["']$/g, "");
}

const prisma = new PrismaClient({ datasources: { db: { url: conexaoGuardada() } } });

const linhas = await prisma.auditLog.findMany({
  where: { ipAddress: { not: null } },
  select: { ipAddress: true, createdAt: true, action: true },
  orderBy: { createdAt: "desc" },
  take: 40,
});

const distintos = new Map();
for (const l of linhas) distintos.set(l.ipAddress, (distintos.get(l.ipAddress) ?? 0) + 1);

console.log(`\nÚltimos ${linhas.length} registros com IP. Endereços distintos: ${distintos.size}\n`);
for (const [ip, quantas] of [...distintos].sort((a, b) => b[1] - a[1])) {
  const primeiro = Number(ip.split(".")[0]);
  const privado = primeiro === 10 || primeiro === 127 || ip.startsWith("192.168.") || ip.startsWith("172.");
  console.log(`  ${ip.padEnd(24)} ${String(quantas).padStart(3)}x  ${privado ? "PRIVADO (proxy escondendo)" : "público"}`);
}

await prisma.$disconnect();
