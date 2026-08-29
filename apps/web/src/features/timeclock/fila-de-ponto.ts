import { apiFetch, ApiError } from "@/lib/api-client";

/**
 * As marcações que ainda não chegaram ao servidor.
 *
 * O ponto é o único lugar do sistema onde ficar offline não pode ser desculpa.
 * A regra que o módulo segue desde o começo — e que vem da Portaria 671 — é
 * que NENHUMA marcação pode ser bloqueada. Só que, sem internet, ela era: a
 * tela dava erro e a pessoa ia trabalhar sem registro.
 *
 * Isso é diferente de vender offline. Uma marcação é um fato sobre uma pessoa
 * e um instante; não depende de saldo, preço nem autorização que morem no
 * servidor. Guardar no aparelho e entregar depois não abre risco nenhum de
 * integridade — só adia a entrega.
 *
 * O QUE VAI JUNTO, E POR QUÊ
 *
 * O horário do APARELHO viaja com a marcação. O servidor continua carimbando o
 * horário dele, que é o autoritativo, e guarda o do aparelho em
 * `clientTimestamp` — o campo já existia justamente para medir essa distância.
 * Numa marcação represada por três horas, a diferença entre os dois é a
 * informação: sem ela, uma entrada das 8h chegaria como 11h e viraria atraso
 * de quem chegou no horário.
 */

const CHAVE = "rs.pontoPendente";

export interface MarcacaoPendente {
  /** Identificador local, para não enviar a mesma duas vezes. */
  id: string;
  type: string;
  deviceId: string;
  justification?: string | undefined;
  /** Quando a pessoa apertou o botão, pelo relógio do tablet. */
  registradoEm: string;
}

function ler(): MarcacaoPendente[] {
  try {
    const bruto = localStorage.getItem(CHAVE);
    return bruto ? (JSON.parse(bruto) as MarcacaoPendente[]) : [];
  } catch {
    // Armazenamento corrompido ou bloqueado. Perder a fila é ruim; travar a
    // tela de ponto por causa dela é pior.
    return [];
  }
}

function gravar(fila: MarcacaoPendente[]): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(fila));
  } catch {
    // Sem espaço. Nada a fazer aqui — quem chamou já mostrou a marcação na
    // tela, e é dela que a pessoa se lembra.
  }
}

export function marcacoesPendentes(): MarcacaoPendente[] {
  return ler();
}

/**
 * Guarda uma marcação que não conseguiu ser enviada.
 *
 * Devolve a marcação guardada para a tela poder dizer, com o horário certo,
 * que o registro existe e está esperando.
 */
export function guardarMarcacao(params: {
  type: string;
  deviceId: string;
  justification?: string | undefined;
}): MarcacaoPendente {
  const marcacao: MarcacaoPendente = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: params.type,
    deviceId: params.deviceId,
    ...(params.justification ? { justification: params.justification } : {}),
    registradoEm: new Date().toISOString(),
  };

  gravar([...ler(), marcacao]);
  return marcacao;
}

export interface ResultadoDoEnvio {
  enviadas: number;
  restantes: number;
}

/**
 * Entrega o que está represado, em ordem.
 *
 * EM ORDEM e uma de cada vez, de propósito: a máquina de estado do ponto
 * — entrada, pausa, volta, saída — depende da sequência. Mandar em paralelo
 * faria a saída chegar antes da entrada, e o servidor recusaria a segunda por
 * um motivo que não é o verdadeiro.
 *
 * Uma marcação recusada pelo servidor sai da fila. Se ela é inválida, tentar
 * de novo para sempre só faria a fila crescer e travar as seguintes — e a
 * pessoa nunca saberia. Falha de rede, essa sim, mantém na fila.
 */
export async function enviarMarcacoesPendentes(): Promise<ResultadoDoEnvio> {
  const fila = ler();
  if (fila.length === 0) return { enviadas: 0, restantes: 0 };

  let enviadas = 0;
  const sobraram: MarcacaoPendente[] = [];

  for (const marcacao of fila) {
    // Uma vez fora, o resto continua esperando: sem rede não adianta insistir
    // nas seguintes, e tentar todas gastaria o tempo da tela à toa.
    if (sobraram.length > 0) {
      sobraram.push(marcacao);
      continue;
    }

    try {
      await apiFetch("/api/v1/timeclock/punch", {
        method: "POST",
        body: {
          type: marcacao.type,
          deviceId: marcacao.deviceId,
          ...(marcacao.justification ? { justification: marcacao.justification } : {}),
          clientTimestamp: marcacao.registradoEm,
        },
      });

      enviadas += 1;
    } catch (erro) {
      // O servidor respondeu e recusou: a marcação não vale, e insistir só
      // travaria a fila. Erro sem resposta é rede — mantém.
      if (erro instanceof ApiError) continue;

      sobraram.push(marcacao);
    }
  }

  gravar(sobraram);
  return { enviadas, restantes: sobraram.length };
}
