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

/** De quanto em quanto tempo conferir. */
const INTERVALO_MS = 15 * 60_000;

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

/**
 * Onde é seguro recarregar sem estragar o que alguém está fazendo.
 *
 * Uma recarga no meio de uma venda apaga o carrinho, e a vendedora perde o
 * cliente de vista para remontá-lo. Nas telas de entrada não há nada a perder
 * — é ali que a troca acontece sozinha.
 */
function momentoSeguro(): boolean {
  const tela = window.location.pathname;
  return tela === "/pin" || tela === "/login" || tela === "/";
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
