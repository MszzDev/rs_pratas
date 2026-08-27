import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/**
 * Faz a versão publicada chegar ao tablet.
 *
 * O aplicativo do balcão carrega as telas do site publicado — é o que permite
 * corrigir um botão sem visitar cinco lojas. Só que o WebView do Android
 * guarda o documento principal no cache dele e NÃO o revalida: publicar o site
 * não mudava nada no tablet, e reiniciar o aplicativo também não. O aparelho
 * ficava numa versão antiga sem nada na tela dizendo isso.
 *
 * Foi descoberto do pior jeito: uma funcionalidade nova estava publicada,
 * funcionando no computador, e simplesmente não existia no tablet.
 *
 * A saída é comparar versões por conta própria. O `index.html` publicado
 * aponta para um pacote com nome versionado (`index-Dxi_Ixmc.js`); buscar esse
 * arquivo sem cache e comparar o nome com o que está carregado responde, sem
 * ambiguidade, se há coisa nova.
 *
 * Recarregar usa um endereço com carimbo de tempo, e não `location.reload()`:
 * o reload comum volta a pedir a mesma URL, e o WebView responde do mesmo
 * cache que criou o problema.
 */

/**
 * De quanto em quanto tempo conferir.
 *
 * Três minutos. A conferência é um pedido de alguns kilobytes, e o custo de
 * demorar é alto: enquanto o tablet não troca, ele mostra uma versão em que o
 * defeito recém-corrigido continua lá.
 */
const INTERVALO_MS = 3 * 60_000;

/**
 * Quantas telas dizem "não recarregue agora".
 *
 * A regra antiga era pela rota: só trocava sozinho no PIN e no login. Timida
 * demais — um tablet parado em qualquer outra tela ficava esperando alguém
 * apertar um botão que ninguém via, e a atualização virava manual de novo.
 *
 * Invertido: recarregar é o padrão, e quem tem algo a perder AVISA. Hoje é só
 * o PDV, enquanto há carrinho montado ou pagamento em andamento — que é, de
 * fato, a única coisa na tela que uma recarga destrói.
 */
let travas = 0;

/**
 * Segura a atualização enquanto existe algo que a recarga apagaria.
 *
 * Devolve a função que solta. Contador, e não booleano: duas telas podem
 * segurar ao mesmo tempo, e a primeira a soltar não pode liberar pela outra.
 */
export function segurarAtualizacao(): () => void {
  travas += 1;
  let soltou = false;

  return () => {
    if (soltou) return;
    soltou = true;
    travas -= 1;
  };
}

/** O nome do pacote que ESTA página carregou. */
function pacoteCarregado(): string | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>("script[src]")) {
    const nome = script.src.split("/").pop();
    if (nome?.startsWith("index-")) return nome;
  }
  return null;
}

async function pacotePublicado(): Promise<string | null> {
  try {
    const resposta = await fetch(`/index.html?v=${Date.now()}`, { cache: "no-store" });
    if (!resposta.ok) return null;

    return /index-[A-Za-z0-9_-]+\.js/.exec(await resposta.text())?.[0] ?? null;
  } catch {
    // Sem rede. Não é erro: o tablet continua trabalhando na versão que tem.
    return null;
  }
}

function recarregar(): void {
  const destino = `${window.location.pathname}?v=${Date.now()}`;
  window.location.replace(destino);
}

/** Ninguém segurando: dá para trocar sem estragar nada. */
function momentoSeguro(): boolean {
  return travas === 0;
}

/**
 * Liga a verificação.
 *
 * Devolve uma função que informa se há versão nova esperando, para a tela
 * poder oferecer "Atualizar agora" a quem estiver no meio de algo.
 */
export function vigiarAtualizacoes(aoEncontrar: (aplicar: () => void) => void): () => void {
  // Só no aplicativo: no navegador do computador, recarregar a página já busca
  // a versão nova, e ninguém precisa de aviso para isso.
  if (!Capacitor.isNativePlatform()) return () => undefined;

  const atual = pacoteCarregado();
  let parado = false;
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  const conferir = async () => {
    if (parado) return;

    const publicado = await pacotePublicado();

    if (publicado && atual && publicado !== atual) {
      if (momentoSeguro()) {
        recarregar();
        return;
      }

      aoEncontrar(recarregar);
    }

    temporizador = setTimeout(() => void conferir(), INTERVALO_MS);
  };

  // Uma conferência ao abrir e outra a cada volta do segundo plano: é quando o
  // tablet passa mais tempo parado, e quando trocar de versão custa menos.
  void conferir();

  const inscricao = App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) void conferir();
  });

  return () => {
    parado = true;
    if (temporizador) clearTimeout(temporizador);
    void inscricao.then((ouvinte) => ouvinte.remove());
  };
}
