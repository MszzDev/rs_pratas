import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A confirmação do sistema, no lugar da caixa cinza do navegador.
 *
 * `window.prompt` funciona, e é feio de um jeito que importa: aparece colado
 * no topo da janela, com a tipografia do sistema operacional e o endereço do
 * site como título ("rs-pratas-web.onrender.com diz"). No meio de uma operação
 * séria — remover uma loja, desvincular um tablet — parece um alerta de golpe,
 * e é exatamente a hora em que a pessoa precisa confiar no que está lendo.
 *
 * Além do visual, ele é um problema de conteúdo: cabe uma linha, sem espaço
 * para dizer o que vai acontecer. Aqui cabe o aviso inteiro.
 *
 * O motivo continua obrigatório onde era: é ele que transforma o registro de
 * auditoria em explicação, seis meses depois.
 */

interface PedidoDeConfirmacao {
  titulo: string;
  descricao?: string;
  /** Texto do botão que confirma. Diga o verbo: "Remover", "Desvincular". */
  acao?: string;
  /** Pede um motivo escrito, que vai para a auditoria. */
  pedirMotivo?: boolean;
  rotuloDoMotivo?: string;
  minimoDoMotivo?: number;
  /** Ação destrutiva pinta o botão de vermelho. */
  destrutivo?: boolean;
}

type Resolver = (resultado: string | null) => void;

const ConfirmContext = createContext<((pedido: PedidoDeConfirmacao) => Promise<string | null>) | null>(
  null,
);

/**
 * Devolve a função de confirmar.
 *
 * Sem motivo: resolve com "" quando a pessoa confirma, e `null` quando
 * desiste. Com motivo: resolve com o texto escrito. Em todos os casos, `null`
 * significa "não faça".
 */
export function useConfirm() {
  const confirmar = useContext(ConfirmContext);

  if (!confirmar) {
    throw new Error("useConfirm precisa estar dentro de <ConfirmProvider>.");
  }

  return confirmar;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<PedidoDeConfirmacao | null>(null);
  const [motivo, setMotivo] = useState("");
  const resolver = useRef<Resolver | null>(null);

  const confirmar = useCallback((novo: PedidoDeConfirmacao) => {
    setPedido(novo);
    setMotivo("");

    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const responder = (resultado: string | null) => {
    resolver.current?.(resultado);
    resolver.current = null;
    setPedido(null);
    setMotivo("");
  };

  const valor = useMemo(() => confirmar, [confirmar]);

  const minimo = pedido?.minimoDoMotivo ?? 3;
  const motivoOk = !pedido?.pedirMotivo || motivo.trim().length >= minimo;

  return (
    <ConfirmContext.Provider value={valor}>
      {children}

      {pedido && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-text-primary/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-confirmacao"
        >
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lifted">
            <div className="flex gap-3">
              {pedido.destrutivo && (
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-danger/10 text-danger"
                  aria-hidden
                >
                  <AlertTriangle className="h-5 w-5" />
                </span>
              )}

              <div className="min-w-0">
                <h2 id="titulo-confirmacao" className="text-lg font-semibold text-text-primary">
                  {pedido.titulo}
                </h2>

                {pedido.descricao && (
                  <p className="mt-1 text-sm text-text-secondary">{pedido.descricao}</p>
                )}
              </div>
            </div>

            {pedido.pedirMotivo && (
              <div className="mt-4">
                <label
                  htmlFor="motivo-confirmacao"
                  className="mb-1 block text-sm font-medium text-text-secondary"
                >
                  {pedido.rotuloDoMotivo ?? "Por quê?"}
                </label>

                <textarea
                  id="motivo-confirmacao"
                  rows={3}
                  autoFocus
                  value={motivo}
                  onChange={(evento) => setMotivo(evento.target.value)}
                  className="w-full rounded-md border border-border bg-surface p-3 text-base text-text-primary outline-none focus:border-rose-primary focus:ring-2 focus:ring-rose-soft"
                  placeholder="Escreva com suas palavras"
                />

                <p className="mt-1 text-sm text-text-muted">
                  Fica registrado na auditoria, junto com o seu nome. É o que explica esta decisão
                  daqui a seis meses.
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => responder(null)}>
                Cancelar
              </Button>

              <Button
                type="button"
                disabled={!motivoOk}
                className={pedido.destrutivo ? "bg-danger hover:bg-danger/90" : undefined}
                onClick={() => responder(pedido.pedirMotivo ? motivo.trim() : "")}
              >
                {pedido.acao ?? "Confirmar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
