import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, History, PackagePlus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ProductPhoto } from "@/components/ui/product-photo";

interface StockRow {
  id: string;
  storeId: string;
  storeName: string;
  productId: string;
  variationId: string | null;
  sku: string;
  name: string;
  size: string | null;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minQuantity: number;
  lowStock: boolean;
  imageChecksum: string | null;
}

interface Movement {
  id: string;
  type: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  createdAt: string;
  user: { name: string; employeeCode: string } | null;
}

interface StoreRow {
  id: string;
  name: string;
}

const MOVEMENT_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  AJUSTE: "Ajuste",
  TRANSFERENCIA_SAIDA: "Saiu em transferência",
  TRANSFERENCIA_ENTRADA: "Chegou por transferência",
  VENDA: "Venda",
  DEVOLUCAO: "Devolução",
  INVENTARIO: "Inventário",
  PERDA: "Perda",
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function StockPage() {
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Item aberto para ajuste, e item aberto para histórico — nunca os dois. */
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [newQuantity, setNewQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [historyOf, setHistoryOf] = useState<StockRow | null>(null);

  /**
   * Entrada de peça que JÁ existe no catálogo — a chegada de mercadoria do
   * fornecedor. Reaproveita o produto cadastrado: quem repõe não deveria ter
   * que passar pela tela de cadastro só para somar dez peças.
   */
  const [entryOf, setEntryOf] = useState<StockRow | null>(null);
  const [entryQuantity, setEntryQuantity] = useState("");
  const [entryCost, setEntryCost] = useState("");
  const [entryReason, setEntryReason] = useState("");

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<StoreRow[]>("/api/v1/stores"),
  });

  const stock = useQuery({
    queryKey: ["stock", storeId, search, lowOnly],
    queryFn: () => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (search) params.set("search", search);
      if (lowOnly) params.set("lowStockOnly", "true");
      return apiFetch<StockRow[]>(`/api/v1/stock?${params.toString()}`);
    },
  });

  const movements = useQuery({
    queryKey: ["stock-movements", historyOf?.id],
    queryFn: () => apiFetch<Movement[]>(`/api/v1/stock/${historyOf?.id}/movements`),
    enabled: historyOf !== null,
  });

  const adjust = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/stock/adjustments", {
        method: "POST",
        body: {
          storeId: adjusting?.storeId,
          productId: adjusting?.productId,
          ...(adjusting?.variationId ? { variationId: adjusting.variationId } : {}),
          newQuantity: Number(newQuantity),
          reason,
        },
      }),
    onSuccess: () => {
      setError(null);
      setAdjusting(null);
      setNewQuantity("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível ajustar."),
  });

  const registrarEntrada = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/stock/entries", {
        method: "POST",
        body: {
          storeId: entryOf?.storeId,
          productId: entryOf?.productId,
          ...(entryOf?.variationId ? { variationId: entryOf.variationId } : {}),
          quantity: Number(entryQuantity),
          reason: entryReason,
          ...(entryCost ? { unitCost: Number(entryCost) } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setEntryOf(null);
      setEntryQuantity("");
      setEntryCost("");
      setEntryReason("");
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível registrar."),
  });

  return (
    <PageShell
      eyebrow="Operação"
      title="Estoque"
      description="Saldo por loja. Cada mudança fica registrada com autor e motivo."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-[12rem]">
          <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="loja">
            Loja
          </label>
          <select
            id="loja"
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
          >
            <option value="">Todas</option>
            {stores.data?.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[14rem] flex-1">
          <Field
            label="Buscar"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome ou código"
          />
        </div>

        <label className="flex min-h-[48px] items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            className="h-5 w-5 accent-rose-primary"
            checked={lowOnly}
            onChange={(event) => setLowOnly(event.target.checked)}
          />
          Só estoque baixo
        </label>
      </div>

      {entryOf && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-soft"
          onSubmit={(event) => {
            event.preventDefault();
            registrarEntrada.mutate();
          }}
        >
          <h2 className="mb-1 font-medium text-text-primary">
            Entrada de {entryOf.name}
            {entryOf.size ? ` — tamanho ${entryOf.size}` : ""}
          </h2>
          <p className="mb-4 text-sm text-text-secondary">
            Em {entryOf.storeName}. Hoje há {entryOf.quantity} peça(s); o que você informar é
            somado ao que já existe.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Quantas chegaram"
              type="number"
              min={1}
              required
              autoFocus
              value={entryQuantity}
              onChange={(event) => setEntryQuantity(event.target.value)}
            />
            <Field
              label="Custo por peça (R$)"
              type="number"
              step="0.01"
              min={0}
              value={entryCost}
              onChange={(event) => setEntryCost(event.target.value)}
              hint="Opcional. Fica no movimento, para a margem do relatório."
            />
            <Field
              label="De onde veio"
              required
              value={entryReason}
              onChange={(event) => setEntryReason(event.target.value)}
              hint="Ex.: nota 4471 do fornecedor."
            />
          </div>

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={registrarEntrada.isPending}>
              Registrar entrada
            </Button>
            <Button type="button" variant="outline" onClick={() => setEntryOf(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {adjusting && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            adjust.mutate();
          }}
        >
          <h2 className="mb-1 font-medium text-text-primary">
            Ajustar {adjusting.name}
            {adjusting.size ? ` — tamanho ${adjusting.size}` : ""}
          </h2>
          <p className="mb-4 text-sm text-text-secondary">
            Em {adjusting.storeName}. Informe quantas peças você contou de verdade, não a diferença.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Quantidade contada"
              type="number"
              min={0}
              required
              value={newQuantity}
              onChange={(event) => setNewQuantity(event.target.value)}
            />
            <Field
              label="O que aconteceu"
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              hint="Ex.: peça quebrada na vitrine, sobra na conferência."
            />
          </div>

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={adjust.isPending}>
              Registrar ajuste
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdjusting(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {historyOf && (
        <div className="mb-6 rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium text-text-primary">
              Histórico de {historyOf.name} em {historyOf.storeName}
            </h2>
            <Button type="button" variant="ghost" onClick={() => setHistoryOf(null)}>
              Fechar
            </Button>
          </div>

          <ul className="space-y-2">
            {movements.data?.map((movement) => (
              <li
                key={movement.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 text-sm last:border-0"
              >
                <div>
                  <span className="font-medium text-text-primary">
                    {MOVEMENT_LABELS[movement.type] ?? movement.type}
                  </span>
                  <span className="ml-2 text-text-secondary">
                    {movement.quantityBefore} → {movement.quantityAfter}
                  </span>
                  {movement.reason && (
                    <span className="ml-2 text-text-muted">· {movement.reason}</span>
                  )}
                </div>
                <span className="text-text-muted">
                  {formatDateTime(movement.createdAt)}
                  {movement.user ? ` · ${movement.user.name}` : ""}
                </span>
              </li>
            ))}
          </ul>

          {movements.data?.length === 0 && (
            <p className="text-sm text-text-muted">Nenhum movimento registrado.</p>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {stock.data?.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5"
          >
            <div className="flex items-start gap-3">
              <ProductPhoto
                productId={row.productId}
                checksum={row.imageChecksum}
                alt={row.name}
                size="md"
              />
              <div>
              <p className="font-medium text-text-primary">
                {row.name}
                {row.size ? ` — tamanho ${row.size}` : ""}
              </p>
              <p className="text-sm text-text-secondary">
                {row.sku} · {row.storeName}
              </p>

              {row.lowStock && (
                <span className="mt-2 inline-flex items-center gap-1 rounded bg-warning/10 px-2 py-0.5 text-sm text-warning">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  Abaixo do mínimo de {row.minQuantity}
                </span>
              )}
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-2xl font-semibold text-text-primary">{row.availableQuantity}</p>
                <p className="text-sm text-text-muted">
                  disponível
                  {row.reservedQuantity > 0 ? ` · ${row.reservedQuantity} reservada(s)` : ""}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setHistoryOf(row);
                    setAdjusting(null);
                    setEntryOf(null);
                  }}
                >
                  <History className="h-5 w-5" aria-hidden />
                  Histórico
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEntryOf(row);
                    setAdjusting(null);
                    setHistoryOf(null);
                    setEntryQuantity("");
                    setEntryCost("");
                    setEntryReason("");
                  }}
                >
                  <PackagePlus className="h-5 w-5" aria-hidden />
                  Entrada
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAdjusting(row);
                    setEntryOf(null);
                    setHistoryOf(null);
                    setNewQuantity(String(row.quantity));
                    setReason("");
                  }}
                >
                  <SlidersHorizontal className="h-5 w-5" aria-hidden />
                  Ajustar
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {stock.data?.length === 0 && (
        <Alert tone="info">
          <span className="flex items-center gap-2">
            <ArrowDownToLine className="h-4 w-4" aria-hidden />
            Nenhuma peça em estoque com esses filtros. Registre uma entrada pela tela de produtos.
          </span>
        </Alert>
      )}
    </PageShell>
  );
}
