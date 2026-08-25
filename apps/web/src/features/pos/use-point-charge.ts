import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";

/**
 * A cobrança que sai do PDV e aparece na maquininha.
 *
 * A vendedora aperta uma vez; o valor vai para a tela do aparelho e o cliente
 * passa o cartão. O sistema fica perguntando "e aí?" até a maquininha
 * responder, e o número do pagamento volta sozinho.
 *
 * Por que perguntar em vez de esperar um aviso: o aviso do Mercado Pago chega
 * pelo webhook, que é rápido mas não é imediato, e a vendedora está com o
 * cliente na frente. Dois segundos de intervalo é o ritmo de quem olha para a
 * maquininha esperando aparecer "aprovado".
 */

const INTERVALO_MS = 2000;
/** Cinco minutos: passou disso, o cliente desistiu e a tela precisa liberar. */
const TENTATIVAS_MAXIMAS = 150;

export interface EstadoDaCobranca {
  intentId: string | null;
  estado: string | null;
  aprovado: boolean;
  paymentId: string | null;
  cobrando: boolean;
  erro: string | null;
}

const INICIAL: EstadoDaCobranca = {
  intentId: null,
  estado: null,
  aprovado: false,
  paymentId: null,
  cobrando: false,
  erro: null,
};

export function usePointCharge() {
  const [estado, setEstado] = useState<EstadoDaCobranca>(INICIAL);
  const cancelado = useRef(false);

  useEffect(
    () => () => {
      cancelado.current = true;
    },
    [],
  );

  const limpar = useCallback(() => setEstado(INICIAL), []);

  const cobrar = useCallback(
    async (params: {
      terminalId: string;
      amount: number;
      description: string;
      externalReference: string;
      installments?: number;
      type?: "credit" | "debit";
    }) => {
      cancelado.current = false;
      setEstado({ ...INICIAL, cobrando: true });

      try {
        const inicio = await apiFetch<{ intentId: string; estado: string }>(
          `/api/v1/terminals/${params.terminalId}/charge`,
          {
            method: "POST",
            body: {
              amount: params.amount,
              description: params.description,
              externalReference: params.externalReference,
              ...(params.installments ? { installments: params.installments } : {}),
              ...(params.type ? { type: params.type } : {}),
            },
          },
        );

        setEstado((atual) => ({ ...atual, intentId: inicio.intentId, estado: inicio.estado }));

        for (let tentativa = 0; tentativa < TENTATIVAS_MAXIMAS; tentativa += 1) {
          await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS));

          // A tela pode ter sido fechada no meio: parar de perguntar é o
          // mínimo, senão o pedido continua batendo na API sem ninguém para
          // receber a resposta.
          if (cancelado.current) return null;

          const situacao = await apiFetch<{
            estado: string;
            aprovado: boolean;
            concluido: boolean;
            paymentId: string | null;
          }>(`/api/v1/terminals/${params.terminalId}/charge/${inicio.intentId}`);

          setEstado((atual) => ({ ...atual, estado: situacao.estado }));

          if (situacao.concluido) {
            setEstado((atual) => ({
              ...atual,
              cobrando: false,
              aprovado: situacao.aprovado,
              paymentId: situacao.paymentId,
              erro: situacao.aprovado ? null : `Não foi aprovado: ${situacao.estado.toLowerCase()}.`,
            }));

            return situacao.aprovado ? situacao.paymentId : null;
          }
        }

        setEstado((atual) => ({
          ...atual,
          cobrando: false,
          erro: "A maquininha não respondeu a tempo. Confira nela antes de cobrar de novo.",
        }));

        return null;
      } catch (caught) {
        setEstado({
          ...INICIAL,
          erro:
            caught instanceof ApiError
              ? caught.message
              : "Não foi possível falar com a maquininha.",
        });

        return null;
      }
    },
    [],
  );

  /** Desistência do cliente com o valor já na tela do aparelho. */
  const cancelar = useCallback(
    async (terminalId: string) => {
      if (!estado.intentId) return;

      cancelado.current = true;

      await apiFetch(`/api/v1/terminals/${terminalId}/charge/${estado.intentId}`, {
        method: "DELETE",
      }).catch(() => undefined);

      limpar();
    },
    [estado.intentId, limpar],
  );

  return { estado, cobrar, cancelar, limpar };
}
