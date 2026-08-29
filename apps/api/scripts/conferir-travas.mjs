/**
 * Confere que as travas de imutabilidade estão todas ativas.
 *
 * Existe por causa de um susto real: o script de limpeza desliga as travas
 * para trabalhar e as religa em seguida. Se ele parar no meio de um jeito que
 * não previmos, o banco pode ficar com a auditoria e o ponto GRAVÁVEIS — e
 * nada na tela diria isso. A imutabilidade é a única proteção do sistema que
 * falha em silêncio absoluto.
 *
 * É só leitura: consulta o catálogo do Postgres e não altera nada.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

function conexaoGuardada() {
  const caminho = join(process.cwd(), "..", "..", ".env.backup");
  const bruto = readFileSync(caminho);
  const utf16 = bruto[0] === 0xff && bruto[1] === 0xfe;
  const texto = bruto.toString(utf16 ? "utf16le" : "utf8").replace(/^﻿/, "");

  const achou = /^\s*DATABASE_URL\s*=\s*(.+)$/m.exec(texto);
  if (!achou) throw new Error("DATABASE_URL não encontrada em .env.backup");

  return achou[1].trim().replace(/^["']|["']$/g, "");
}

const url = conexaoGuardada();
const prisma = new PrismaClient({ datasources: { db: { url } } });
const alvo = new URL(url);

console.log(`Banco: ${alvo.host}${alvo.pathname}\n`);

const gatilhos = await prisma.$queryRawUnsafe(`
  SELECT c.relname AS tabela, t.tgname AS gatilho, t.tgenabled AS estado
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal
    AND t.tgname LIKE '%_no_%'
  ORDER BY c.relname, t.tgname
`);

const porTabela = new Map();
for (const linha of gatilhos) {
  const lista = porTabela.get(linha.tabela) ?? [];
  lista.push(linha);
  porTabela.set(linha.tabela, lista);
}

let soltas = 0;

for (const [tabela, lista] of porTabela) {
  // 'O' = origem (ativo). 'D' = desabilitado.
  const desligados = lista.filter((g) => g.estado === "D");
  soltas += desligados.length;

  const marca = desligados.length === 0 ? "ok  " : "SOLTA";
  console.log(`${marca}  ${tabela} (${lista.length} gatilho(s))`);
}

console.log(
  soltas === 0
    ? `\n${porTabela.size} tabelas protegidas, todas as travas ativas.`
    : `\nATENÇÃO: ${soltas} trava(s) desligada(s). Histórico pode ser reescrito.`,
);

await prisma.$disconnect();
process.exit(soltas === 0 ? 0 : 1);
