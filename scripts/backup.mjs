#!/usr/bin/env node
/**
 * Cópia de segurança do banco do RS Pratas.
 *
 *   node scripts/backup.mjs                      usa DATABASE_URL do ambiente
 *   node scripts/backup.mjs "postgresql://..."   usa a conexão informada
 *   node scripts/backup.mjs --verificar          confere a última cópia
 *
 * Por que existe: o banco guarda a venda, o caixa, o ponto oficial e a
 * auditoria — histórico que a loja é obrigada a ter e que não se refaz. O
 * plano gratuito da hospedagem tem prazo de validade; o dia em que ele expirar
 * não vai avisar antes.
 *
 * O dump sai comprimido, com data e hora no nome, e o script CONFERE o que
 * gravou antes de dizer que deu certo. Cópia que ninguém abriu é esperança,
 * não backup.
 */
import { execFileSync, execSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createGunzip, gzipSync } from "node:zlib";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

/**
 * A conexão guardada em ./.env.backup.
 *
 * Existe porque a cópia automática roda sem ninguém por perto: o Agendador de
 * Tarefas do Windows dispara o script sozinho, e não há onde digitar a senha
 * do banco. O arquivo fica fora do git (.gitignore) — é a única credencial que
 * mora no computador do dono.
 *
 * Aceita arquivo salvo em UTF-16, que é o que o PowerShell gera com `>` e foi
 * o que quebrou a primeira tentativa: o conteúdo parecia certo na tela e
 * chegava aqui como caracteres separados por zeros.
 */
function conexaoGuardada() {
  const caminho = join(process.cwd(), ".env.backup");
  if (!existsSync(caminho)) return null;

  const bruto = readFileSync(caminho);
  const utf16 = bruto[0] === 0xff && bruto[1] === 0xfe;
  const texto = bruto.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");

  for (const linha of texto.split(/\r?\n/)) {
    const achou = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.+)$/.exec(linha);
    if (achou) return achou[1].trim().replace(/^["']|["']$/g, "");
  }

  return null;
}

/** Quantas cópias manter. As mais antigas saem sozinhas. */
const MANTER = 14;

const PASTA = join(process.cwd(), "backups");

/** Imagem usada quando não há pg_dump instalado na máquina. */
const IMAGEM = "postgres:16-alpine";

function agora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function existe(comando) {
  try {
    execFileSync(comando, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Escolhe como rodar o pg_dump.
 *
 * Preferimos o instalado na máquina; sem ele, um contêiner descartável. Assim
 * o backup não depende de o dono ter instalado o Postgres — ele precisa de uma
 * cópia, não de um ambiente de desenvolvimento montado.
 */
function comoRodar() {
  if (existe("pg_dump")) return "nativo";
  if (existe("docker")) return "docker";

  console.error(
    "Não achei pg_dump nem docker.\n" +
      "Instale o Docker Desktop (mais simples) ou as ferramentas de linha de comando do PostgreSQL.",
  );
  process.exit(1);
}

/**
 * A versão do servidor, quando ele reclama de incompatibilidade.
 *
 * O pg_dump se recusa a copiar um banco mais novo que ele — e com razão: o
 * formato muda, e um dump truncado só se descobre inútil no dia em que era a
 * única cópia. A mensagem de recusa diz a versão do servidor, e é dela que
 * sai a imagem certa para tentar de novo.
 */
function versaoDoServidor(erro) {
  const texto = `${erro?.stderr ?? ""}`;
  return /server version: (\d+)/.exec(texto)?.[1] ?? null;
}

function gerar(url, destino) {
  const modo = comoRodar();

  // --no-owner e --no-acl: o dump precisa restaurar num banco com outro dono,
  // que é justamente o caso de restaurar em outro servidor. Sem isso a
  // restauração falha em cada GRANT que menciona uma role inexistente.
  const argumentos = ["--no-owner", "--no-acl", "--format=plain", url];

  const noDocker = (imagem) =>
    execFileSync(
      "docker",
      ["run", "--rm", "-i", "--network=host", imagem, "pg_dump", ...argumentos],
      { maxBuffer: 1024 * 1024 * 512 },
    );

  console.log(`  gerando com pg_dump (${modo})...`);

  let saida;

  try {
    saida =
      modo === "nativo"
        ? execFileSync("pg_dump", argumentos, { maxBuffer: 1024 * 1024 * 512 })
        : noDocker(IMAGEM);
  } catch (erro) {
    const versao = versaoDoServidor(erro);

    if (!versao) throw erro;

    // O servidor é mais novo que o pg_dump daqui. Em vez de falhar pedindo
    // que alguém atualize o Postgres da máquina, busca a ferramenta na
    // versão que o servidor pede — o backup não pode depender do que está
    // instalado no computador de quem o roda.
    if (!existe("docker")) {
      console.error(
        `O banco é PostgreSQL ${versao} e o pg_dump desta máquina é mais antigo.\n` +
          "Instale o Docker Desktop (o script busca a versão certa sozinho) ou\n" +
          `atualize as ferramentas do PostgreSQL para a versão ${versao}.`,
      );
      process.exit(1);
    }

    console.log(`  servidor é PostgreSQL ${versao} — refazendo com a ferramenta dessa versão...`);
    saida = noDocker(`postgres:${versao}-alpine`);
  }

  // Compressão pelo próprio Node, e não pelo `gzip` do sistema: no Windows
  // esse comando não existe fora do Git Bash, e o backup falhava DEPOIS de
  // copiar o banco inteiro — o trabalho todo perdido no último passo.
  writeFileSync(destino, gzipSync(saida, { level: 9 }));
}

/**
 * Confere que o arquivo é um dump utilizável.
 *
 * Lê o começo do arquivo procurando as marcas que todo dump do PostgreSQL tem
 * e ao menos uma tabela nossa. Um arquivo de 20 bytes com erro dentro também
 * "existe" — e é exatamente o tipo de cópia que só se descobre inútil no dia
 * em que ela era a única.
 */
async function conferir(caminho) {
  const marcas = { cabecalho: false, tabela: false, fim: false };
  let linhas = 0;

  const leitor = createInterface({
    input: createReadStream(caminho).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const linha of leitor) {
    linhas += 1;
    if (linha.includes("PostgreSQL database dump")) marcas.cabecalho = true;
    if (/CREATE TABLE public\.(users|sales|audit_logs|time_clock_entries)/.test(linha)) {
      marcas.tabela = true;
    }
    if (linha.includes("PostgreSQL database dump complete")) marcas.fim = true;
  }

  return { ...marcas, linhas, ok: marcas.cabecalho && marcas.tabela && marcas.fim };
}

function limparAntigos() {
  const copias = readdirSync(PASTA)
    .filter((nome) => nome.endsWith(".sql.gz"))
    .sort()
    .reverse();

  const sobrando = copias.slice(MANTER);
  for (const nome of sobrando) {
    unlinkSync(join(PASTA, nome));
  }

  return sobrando.length;
}

function ultimaCopia() {
  if (!existsSync(PASTA)) return null;

  const copias = readdirSync(PASTA)
    .filter((nome) => nome.endsWith(".sql.gz"))
    .sort()
    .reverse();

  return copias[0] ? join(PASTA, copias[0]) : null;
}

async function main() {
  const argumentos = process.argv.slice(2);

  if (argumentos.includes("--verificar")) {
    const caminho = ultimaCopia();

    if (!caminho) {
      console.error("Nenhuma cópia encontrada em ./backups.");
      process.exit(1);
    }

    console.log(`Conferindo ${caminho}`);
    const resultado = await conferir(caminho);

    console.log(`  cabeçalho do dump: ${resultado.cabecalho ? "ok" : "AUSENTE"}`);
    console.log(`  tabelas do sistema: ${resultado.tabela ? "ok" : "AUSENTES"}`);
    console.log(`  marca de conclusão: ${resultado.fim ? "ok" : "AUSENTE"}`);
    console.log(`  ${resultado.linhas} linhas`);

    if (!resultado.ok) {
      console.error("\nEsta cópia NÃO serve para restaurar.");
      process.exit(1);
    }

    console.log("\nCópia íntegra.");
    return;
  }

  const url =
    argumentos.find((a) => a.startsWith("postgres")) ??
    process.env.DATABASE_URL ??
    conexaoGuardada();

  if (!url) {
    console.error(
      "Informe a conexão:\n" +
        '  node scripts/backup.mjs "postgresql://usuario:senha@host:5432/banco"\n' +
        "ou defina DATABASE_URL.",
    );
    process.exit(1);
  }

  mkdirSync(PASTA, { recursive: true });

  const destino = join(PASTA, `rs-pratas-${agora()}.sql.gz`);
  const inicio = Date.now();

  gerar(url, destino);

  const tamanho = statSync(destino).size;
  console.log(`  ${(tamanho / 1024).toFixed(0)} KB em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);

  console.log("  conferindo o que foi gravado...");
  const resultado = await conferir(destino);

  if (!resultado.ok) {
    console.error(
      "\nO arquivo foi gerado mas NÃO passou na conferência — não conte com ele.\n" +
        `  cabeçalho: ${resultado.cabecalho} · tabelas: ${resultado.tabela} · conclusão: ${resultado.fim}`,
    );
    process.exit(1);
  }

  const removidos = limparAntigos();

  console.log(`\nCópia pronta: ${destino}`);
  console.log(`  ${resultado.linhas} linhas, íntegra`);
  if (removidos > 0) {
    console.log(`  ${removidos} cópia(s) antiga(s) removida(s) — mantendo as ${MANTER} mais recentes`);
  }
}

await main();
