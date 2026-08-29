import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, PackageCheck, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";

/**
 * Etiqueta de envio a partir da compra na loja virtual.
 *
 * Antes disto, despachar era copiar o endereço do site para um papel à mão —
 * e endereço copiado à mão é endereço com número trocado. Aqui a etiqueta
 * nasce do pedido: o que sai impresso é o que o cliente digitou.
 *
 * A lista mostra quais pedidos já têm etiqueta pedida. Quem atende o balcão
 * entre um pacote e outro perde a conta, imprime duas vezes, e dois endereços
 * colados no mesmo pacote é como um deles vai parar no lugar errado.
 */

interface Pedido {
  id: string;
  numero: number;
  cliente: string | null;
  criadoEm: string;
  total: string;
  situacao: string;
  situacaoDoEnvio: string | null;
  temEndereco: boolean;
  destino: string | null;
  cep: string | null;
  jaEnfileirado: boolean;
}

interface Modelo {
  id: string;
  name: string;
  widthMm: string;
  heightMm: string;
}

const formatarData = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

const formatarCep = (cep: string | null) => {
  if (!cep) return null;
  const digitos = cep.replace(/\D/g, "");
  return digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : cep;
};

export function ShippingLabels({
  storeId,
  modelos,
  onClose,
}: {
  storeId: string;
  modelos: Modelo[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState<string | null>(null);

  /**
   * O modelo é escolhido, e não herdado do padrão da empresa.
   *
   * O padrão é a etiqueta de joia, de 90 × 12 mm. Um endereço nela gastaria o
   * rolo sem dar para ler nada — o servidor recusa por isso, e a tela pergunta
   * antes de deixar tentar.
   */
  const [modeloId, setModeloId] = useState("");

  const pedidos = useQuery({
    queryKey: ["shipping-orders"],
    queryFn: () => apiFetch<Pedido[]>("/api/v1/print-jobs/shipping/orders?dias=30"),
    retry: false,
  });

  const imprimir = useMutation({
    mutationFn: (pedido: Pedido) =>
      apiFetch("/api/v1/print-jobs/shipping", {
        method: "POST",
        body: { storeId, orderId: pedido.id, templateId: modeloId, copies: 1 },
      }),
    onSuccess: (_resultado, pedido) => {
      setErro(null);
      setPronto(`Etiqueta do pedido ${pedido.numero} foi para a fila.`);
      void queryClient.invalidateQueries({ queryKey: ["shipping-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["print-queue"] });
    },
    onError: (caught) => {
      setPronto(null);
      setErro(
        caught instanceof ApiError ? caught.message : "Não foi possível mandar para a fila.",
      );
    },
  });

  const falhaNaLista =
    pedidos.error instanceof ApiError
      ? pedidos.error.message
      : pedidos.isError
        ? "Não foi possível falar com a loja virtual."
        : null;

  return (
    <div className="mb-8 rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-text-primary">Etiquetas de envio</h2>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={pedidos.isFetching}
            onClick={() => pedidos.refetch()}
          >
            <RefreshCw className="h-5 w-5" aria-hidden />
            {pedidos.isFetching ? "Buscando..." : "Buscar pedidos"}
          </Button>

          <Button type="button" variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>

      {erro && (
        <div className="mb-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}
      {pronto && (
        <div className="mb-4">
          <Alert tone="success">{pronto}</Alert>
        </div>
      )}
      {falhaNaLista && (
        <div className="mb-4">
          <Alert tone="error">{falhaNaLista}</Alert>
        </div>
      )}

      {storeId === "" && (
        <Alert tone="info">
          Escolha a loja — o pacote sai dela, e é o endereço dela que vai como remetente.
        </Alert>
      )}

      <div className="mb-5 max-w-sm">
        <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="modelo-envio">
          Modelo da etiqueta
        </label>
        <select
          id="modelo-envio"
          value={modeloId}
          onChange={(evento) => setModeloId(evento.target.value)}
          className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
        >
          <option value="">Selecione</option>
          {modelos.map((modelo) => (
            <option key={modelo.id} value={modelo.id}>
              {modelo.name} — {modelo.widthMm} × {modelo.heightMm} mm
            </option>
          ))}
        </select>
        <p className="mt-1 text-sm text-text-muted">
          Use um modelo grande, com o desenho de envio. O da peça não comporta um endereço.
        </p>
      </div>

      {pedidos.data?.length === 0 && (
        <Alert tone="info">Nenhum pedido na loja virtual nos últimos 30 dias.</Alert>
      )}

      <ul className="space-y-3">
        {pedidos.data?.map((pedido) => (
          <li
            key={pedido.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border p-4"
          >
            <div className="min-w-[14rem] flex-1">
              <p className="font-medium text-text-primary">
                Pedido {pedido.numero}
                {pedido.jaEnfileirado && (
                  <span className="ml-2 rounded bg-sage-soft px-2 py-0.5 text-sm text-sage">
                    já pedida
                  </span>
                )}
                {!pedido.temEndereco && (
                  <span className="ml-2 rounded bg-background-secondary px-2 py-0.5 text-sm text-text-muted">
                    sem endereço
                  </span>
                )}
              </p>

              <p className="text-sm text-text-secondary">
                {pedido.cliente ?? "sem nome"} · {formatarData(pedido.criadoEm)}
              </p>

              {pedido.destino && (
                <p className="flex items-center gap-1 text-sm text-text-secondary">
                  <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                  {pedido.destino}
                  {pedido.cep ? ` · ${formatarCep(pedido.cep)}` : ""}
                </p>
              )}
            </div>

            {pedido.temEndereco ? (
              <Button
                type="button"
                variant={pedido.jaEnfileirado ? "outline" : "primary"}
                disabled={imprimir.isPending || modeloId === "" || storeId === ""}
                onClick={() => imprimir.mutate(pedido)}
              >
                {pedido.jaEnfileirado ? (
                  <PackageCheck className="h-5 w-5" aria-hidden />
                ) : (
                  <Printer className="h-5 w-5" aria-hidden />
                )}
                {pedido.jaEnfileirado ? "Imprimir de novo" : "Imprimir etiqueta"}
              </Button>
            ) : (
              // Sem endereço quase sempre é retirada na loja. Dizer isso é
              // melhor que um botão desligado sem explicação.
              <p className="text-sm text-text-muted">Retirada na loja</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
