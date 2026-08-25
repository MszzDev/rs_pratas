import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";

interface Pedido {
  id: string;
  topic: string;
  createdAt: string;
  processedAt: string | null;
  cliente: { id: string; name: string; phone: string | null } | null;
  descricao: string;
}

/**
 * Pedidos de dado pessoal vindos da loja virtual.
 *
 * Um cliente pediu para apagar os dados dele, ou pediu uma cópia. A lei dá
 * prazo para responder, e o pedido chega em silêncio, por webhook — sem uma
 * fila visível ele viraria uma linha perdida no meio dos eventos.
 *
 * Atender é um clique SEU, não do sistema: apagar cliente porque uma mensagem
 * da internet mandou é o tipo de coisa que, feita errado, não tem volta.
 */
export function LgpdRequests() {
  const queryClient = useQueryClient();
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copia, setCopia] = useState<string | null>(null);

  const pedidos = useQuery({
    queryKey: ["lgpd"],
    queryFn: () => apiFetch<Pedido[]>("/api/v1/integrations/lgpd"),
  });

  const atender = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ resultado: string }>(`/api/v1/integrations/lgpd/${id}/fulfill`, {
        method: "POST",
      }),
    onSuccess: (resposta) => {
      setErro(null);
      setResultado(resposta.resultado);
      void queryClient.invalidateQueries({ queryKey: ["lgpd"] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível atender o pedido."),
  });

  const gerarCopia = useMutation({
    mutationFn: (customerId: string) =>
      apiFetch<unknown>(`/api/v1/integrations/lgpd/customers/${customerId}`),
    onSuccess: (dados) => {
      setErro(null);
      setCopia(JSON.stringify(dados, null, 2));
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível montar a cópia."),
  });

  const lista = pedidos.data ?? [];
  const pendentes = lista.filter((pedido) => !pedido.processedAt);

  if (lista.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-medium text-text-primary">
        <ShieldAlert className="h-5 w-5 text-clay" aria-hidden />
        Pedidos sobre dados pessoais
        {pendentes.length > 0 && (
          <span className="rounded-full bg-clay-soft px-2 py-0.5 text-sm text-clay-dark">
            {pendentes.length} a responder
          </span>
        )}
      </h2>
      <p className="mb-3 text-sm text-text-secondary">
        Chegaram da loja virtual. Apagar os dados mantém a compra no histórico, sem identificação —
        a venda continua no faturamento, como a contabilidade exige.
      </p>

      {erro && (
        <div className="mb-3">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}

      {resultado && (
        <div className="mb-3">
          <Alert tone="success">{resultado}</Alert>
        </div>
      )}

      {copia && (
        <div className="mb-3 rounded-md border border-border bg-surface p-4">
          <p className="mb-2 text-sm text-text-secondary">
            Cópia dos dados. Envie para a própria pessoa, depois de confirmar que é ela.
          </p>
          <pre className="max-h-64 overflow-auto rounded bg-background-secondary p-3 text-xs">
            {copia}
          </pre>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(copia)}
            >
              Copiar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCopia(null)}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {lista.map((pedido) => (
          <li
            key={pedido.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-text-primary">{pedido.descricao}</p>
              <p className="text-sm text-text-muted">
                {new Date(pedido.createdAt).toLocaleString("pt-BR")}
                {pedido.processedAt
                  ? ` · atendido em ${new Date(pedido.processedAt).toLocaleDateString("pt-BR")}`
                  : ""}
              </p>
            </div>

            {!pedido.processedAt && (
              <div className="flex gap-2">
                {pedido.topic === "customers/data_request" && pedido.cliente && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={gerarCopia.isPending}
                    onClick={() => gerarCopia.mutate(pedido.cliente!.id)}
                  >
                    Ver os dados
                  </Button>
                )}

                <Button
                  type="button"
                  disabled={atender.isPending}
                  onClick={() => atender.mutate(pedido.id)}
                >
                  {pedido.topic === "customers/redact" ? "Apagar os dados" : "Marcar atendido"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
