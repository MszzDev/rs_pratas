import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * Saber se o sistema alcança o servidor.
 *
 * `navigator.onLine` sozinho não serve. Ele responde "tem rede", que é outra
 * pergunta: o tablet ligado no Wi-Fi da loja com o roteador sem internet
 * continua "online", e o Android às vezes demora a mudar o valor. A loja
 * enxerga a diferença o tempo todo — o aparelho mostra três riscos de sinal e
 * nada carrega.
 *
 * Então o valor do navegador serve como PISTA — quando ele diz que caiu, caiu
 * mesmo — e quem confirma é uma batida no servidor.
 *
 * Isto não é modo offline. É a camada de baixo dele: saber o estado, e saber
 * na hora. Sem isso, cada tela descobre a queda sozinha, do seu jeito, e o
 * funcionário vê cinco mensagens diferentes para o mesmo problema.
 */

/** De quanto em quanto tempo bater no servidor enquanto está fora. */
const INTERVALO_FORA_MS = 10_000;

/** E enquanto está dentro — mais espaçado, porque nada depende dele. */
const INTERVALO_DENTRO_MS = 60_000;

export type EstadoDaConexao = "verificando" | "conectado" | "sem-servidor";

const ouvintes = new Set<(estado: EstadoDaConexao) => void>();
let estadoAtual: EstadoDaConexao = "verificando";
let temporizador: ReturnType<typeof setTimeout> | undefined;

function anunciar(novo: EstadoDaConexao): void {
  if (novo === estadoAtual) return;

  estadoAtual = novo;
  for (const ouvinte of ouvintes) ouvinte(novo);
}

/**
 * Bate no /health, que é a rota mais barata que existe e não pede
 * autenticação — perguntar "o servidor está de pé?" não pode depender de
 * estar logado, senão a resposta some justamente quando o token expira.
 */
async function alcancaServidor(): Promise<boolean> {
  try {
    await apiFetch("/health", { skipAuthRetry: true });
    return true;
  } catch {
    return false;
  }
}

async function conferir(): Promise<void> {
  // O navegador dizendo que não há rede é conclusivo: não adianta bater.
  if (!navigator.onLine) {
    anunciar("sem-servidor");
    agendar();
    return;
  }

  anunciar((await alcancaServidor()) ? "conectado" : "sem-servidor");
  agendar();
}

function agendar(): void {
  if (temporizador) clearTimeout(temporizador);

  // Fora, pergunta com frequência: a volta da internet precisa ser percebida
  // rápido, porque é quando o que ficou represado sai. Dentro, devagar.
  temporizador = setTimeout(
    () => void conferir(),
    estadoAtual === "conectado" ? INTERVALO_DENTRO_MS : INTERVALO_FORA_MS,
  );
}

/** Liga a vigilância. Chamado uma vez, no início da aplicação. */
export function vigiarConexao(): void {
  void conferir();

  // Os eventos do navegador não substituem a batida, mas antecipam: quando o
  // Wi-Fi volta, dá para conferir na hora em vez de esperar o próximo ciclo.
  window.addEventListener("online", () => void conferir());
  window.addEventListener("offline", () => anunciar("sem-servidor"));
}

/** Força uma conferência agora — usado depois de uma falha de rede numa tela. */
export function reconferirConexao(): void {
  void conferir();
}

export function useConexao(): EstadoDaConexao {
  const [estado, setEstado] = useState<EstadoDaConexao>(estadoAtual);

  useEffect(() => {
    ouvintes.add(setEstado);
    setEstado(estadoAtual);

    return () => {
      ouvintes.delete(setEstado);
    };
  }, []);

  return estado;
}
