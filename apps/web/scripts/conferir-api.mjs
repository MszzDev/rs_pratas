#!/usr/bin/env node
/**
 * Confere o endereço da API antes de gerar o APK.
 *
 * O Vite embute `VITE_API_URL` no pacote. Quando ela falta, ele não reclama:
 * usa `http://localhost:3000`, o build passa, o APK instala, abre — e fica
 * girando para sempre, porque no tablet `localhost` é o próprio tablet.
 *
 * O sintoma é o pior possível: nada na tela diz o que houve, e a suspeita cai
 * na internet da loja, no servidor, no vínculo do aparelho. Foi assim que um
 * APK recém-instalado deixou o tablet do balcão mudo.
 *
 * Este script transforma esse silêncio numa recusa com explicação.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = process.cwd();

function doArquivo() {
  const caminho = join(raiz, ".env.production");
  if (!existsSync(caminho)) return null;

  const achou = /^\s*VITE_API_URL\s*=\s*(.+)$/m.exec(readFileSync(caminho, "utf8"));
  return achou ? achou[1].trim().replace(/^["']|["']$/g, "") : null;
}

// A variável de ambiente vence o arquivo — é a ordem do próprio Vite, e é o
// que permite ao Render apontar para outro servidor sem editar nada aqui.
const url = process.env.VITE_API_URL ?? doArquivo();

if (!url) {
  console.error(
    "Falta VITE_API_URL.\n\n" +
      "Sem ela o aplicativo procura a API em http://localhost:3000, que no\n" +
      "tablet é o próprio tablet — e nada funciona, sem dizer por quê.\n\n" +
      "Defina em apps/web/.env.production ou no ambiente.",
  );
  process.exit(1);
}

if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) {
  console.error(
    `VITE_API_URL aponta para ${url}.\n\n` +
      "Isso serve para desenvolver no computador, não para gerar o APK: no\n" +
      "tablet esse endereço é o próprio aparelho, e ele nunca vai achar a API.\n\n" +
      "Use o endereço público do servidor.",
  );
  process.exit(1);
}

console.log(`API do aplicativo: ${url}`);

/**
 * De onde o tablet carrega as TELAS.
 *
 * Sem CAP_SERVER_URL, o APK sai com as telas embutidas dentro dele — e a
 * partir daí publicar o site deixa de atualizar os tablets. O aparelho fica
 * congelado na versão do dia em que o APK foi gerado, sem nada na tela
 * dizendo isso: ele funciona, só não muda mais.
 *
 * Foi o que aconteceu. Um APK gerado sem a variável deixou o tablet do balcão
 * dias atrás do site, e a diferença só apareceu quando alguém procurou uma
 * tela nova e não achou.
 *
 * Este aviso existe para a próxima vez ser percebida na hora de compilar.
 */
const telas = process.env.CAP_SERVER_URL;

if (!telas) {
  console.error(
    [
      "",
      "CAP_SERVER_URL nao esta definida.",
      "",
      "O APK vai sair com as telas EMBUTIDAS: publicar o site nao vai mais",
      "atualizar este tablet. Serve para testar uma versao local; nao serve",
      "para o aparelho que fica na loja.",
      "",
      "Para o tablet da loja:",
      "  CAP_SERVER_URL=https://rs-pratas-web.onrender.com pnpm apk",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Telas do tablet: ${telas}`);
