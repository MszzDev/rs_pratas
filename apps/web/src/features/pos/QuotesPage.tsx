import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ProductPhoto } from "@/components/ui/product-photo";
import { formatMoney } from "@/lib/money";
import type { StockRow } from "./types";
import { groupByProduct } from "./group-stock";
import { StorePicker } from "@/features/stores/store-picker";

interface Quote {
  id: string;
  code: string;
  status: "ABERTO" | "CONVERTIDO" | "RECUSADO" | "EXPIRADO";
  customerName: string | null;
  customerPhone: string | null;
  customer: { name: string; phone: string } | null;
  totalAmount: string | null;
  validUntil: string;
  store: { name: string };
  items: Array<{ id: string; productName: string; quantity: number; unitPrice: string | null }>;
}


interface QuoteLine {
  productId: string;
  variationId: string | null;
  name: string;
  size: string | null;
  salePrice: string | null;
  imageChecksum: string | null;
  quantity: number;
}

const STATUS_LABELS: Record<Quote["status"], string> = {
  ABERTO: "Aberto",
  CONVERTIDO: "Virou venda",
  RECUSADO: "Recusado",
  EXPIRADO: "Vencido",
};

const STATUS_STYLES: Record<Quote["status"], string> = {
  ABERTO: "bg-info/10 text-info",
  CONVERTIDO: "bg-success/10 text-success",
  RECUSADO: "bg-border text-text-muted",
  EXPIRADO: "bg-warning/10 text-warning",
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/**
 * Orçamento — aba própria, separada da venda.
 *
 * Não reserva peça de propósito: orçamento é o cliente pensando, e travar
 * mercadoria a cada simulação esvaziaria o disponível da loja sem nada ter
 * sido vendido. Quem quer garantir a peça faz reserva, que tem prazo e sinal.
 */
export function QuotesPage() {
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [tamanhosAbertos, setTamanhosAbertos] = useState<string | null>(null);


  const quotes = useQuery({
    queryKey: ["quotes", storeId],
    queryFn: () =>
      apiFetch<Quote[]>(storeId ? `/api/v1/quotes?storeId=${storeId}` : "/api/v1/quotes"),
  });

  const stock = useQuery({
    queryKey: ["quote-stock", storeId, search],
    queryFn: () =>
      apiFetch<StockRow[]>(
        `/api/v1/stock?storeId=${storeId}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      ),
    enabled: creating && storeId !== "",
  });

  // Mesma regra do PDV: uma peça por linha, tamanho escolhido ao tocar.
  const grupos = useMemo(() => groupByProduct(stock.data ?? []), [stock.data]);

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/quotes", {
        method: "POST",
        body: {
          storeId,
          customerName: customerName.trim(),
          ...(customerPhone ? { customerPhone } : {}),
          // Só o que vai levar: o preço é do servidor, como na venda.
          items: lines.map((line) => ({
            productId: line.productId,
            ...(line.variationId ? { variationId: line.variationId } : {}),
            quantity: line.quantity,
          })),
        },
      }),
    onSuccess: () => {
      setError(null);
      setCreating(false);
      setLines([]);
      setCustomerName("");
      setCustomerPhone("");
      void queryClient.invalidateQueries({ queryKey: ["quotes"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível salvar."),
  });

  const total = lines.reduce(
    (sum, line) => sum + Number(line.salePrice ?? 0) * line.quantity,
    0,
  );

  function addLine(row: StockRow) {
    setTamanhosAbertos(null);
    setLines((current) => {
      const key = `${row.productId}:${row.variationId ?? ""}`;
      const existing = current.find(
        (line) => `${line.productId}:${line.variationId ?? ""}` === key,
      );

      return existing
        ? current.map((line) =>
            `${line.productId}:${line.variationId ?? ""}` === key
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          )
        : [
            ...current,
            {
              productId: row.productId,
              variationId: row.variationId,
              name: row.name,
              size: row.size,
              salePrice: row.salePrice,
              imageChecksum: row.imageChecksum,
              quantity: 1,
            },
          ];
    });
  }

  return (
    <PageShell
      title="Orçamentos"
      description="Simulação de preço para o cliente pensar. Não separa peça nem mexe no estoque."
      actions={
        creating ? null : (
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="h-5 w-5" aria-hidden />
            Novo orçamento
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <StorePicker storeId={storeId} onChange={setStoreId} todas className="mb-5 max-w-xs" />

      {creating && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Nome de quem pediu"
              required
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              hint="Não precisa ser cliente cadastrado."
            />
            <Field
              label="Telefone (opcional)"
              inputMode="tel"
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
            />
          </div>

          {!storeId && (
            <Alert tone="info">Escolha a loja acima para buscar as peças.</Alert>
          )}

          {storeId && (
            <>
              <div className="mb-4">
                <Field
                  label="Buscar peça"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nome ou código"
                />
              </div>

              <ul className="mb-4 max-h-72 space-y-2 overflow-y-auto">
                {grupos.map((grupo) => {
                  const aberto = tamanhosAbertos === grupo.productId;
                  const unico = grupo.variacoes[0];

                  return (
                    <li key={grupo.productId}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!grupo.temTamanhos && unico) {
                            addLine(unico);
                            return;
                          }
                          setTamanhosAbertos(aberto ? null : grupo.productId);
                        }}
                        aria-expanded={grupo.temTamanhos ? aberto : undefined}
                        className="flex w-full min-h-[56px] items-center justify-between gap-4 rounded-md border border-border p-2.5 text-left hover:border-rose-primary"
                      >
                        <span className="flex min-w-0 items-center gap-3 text-text-primary">
                          <ProductPhoto
                            productId={grupo.productId}
                            checksum={grupo.imageChecksum}
                            alt={grupo.name}
                            size="sm"
                          />
                          <span className="min-w-0">
                            <span className="block truncate">{grupo.name}</span>
                            {grupo.temTamanhos && (
                              <span className="block text-sm text-text-muted">
                                {grupo.variacoes.length} tamanho(s)
                              </span>
                            )}
                          </span>
                        </span>

                        <span className="flex shrink-0 items-center gap-2 text-text-secondary">
                          {grupo.precoMin === grupo.precoMax
                            ? formatMoney(String(grupo.precoMin))
                            : `${formatMoney(String(grupo.precoMin))} a ${formatMoney(String(grupo.precoMax))}`}
                          {grupo.temTamanhos && (
                            <ChevronDown
                              className={`h-4 w-4 transition-transform ${aberto ? "rotate-180" : ""}`}
                              aria-hidden
                            />
                          )}
                        </span>
                      </button>

                      {grupo.temTamanhos && aberto && (
                        <div className="mt-1 flex flex-wrap gap-2 rounded-md border border-border/70 bg-background-secondary p-2.5">
                          {grupo.variacoes.map((variacao) => (
                            <button
                              key={variacao.id}
                              type="button"
                              onClick={() => addLine(variacao)}
                              className="flex min-h-[48px] min-w-[64px] flex-col items-center justify-center rounded-md border border-border bg-surface px-3 text-sm hover:border-rose-primary"
                            >
                              <span className="font-medium text-text-primary">
                                {variacao.size}
                              </span>
                              <span className="text-xs text-text-muted">
                                {variacao.availableQuantity} un.
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {lines.length > 0 && (
            <ul className="mb-4 space-y-2 border-t border-border pt-4">
              {lines.map((line, index) => (
                <li key={index} className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-text-primary">
                    <ProductPhoto
                      productId={line.productId}
                      checksum={line.imageChecksum}
                      alt={line.name}
                      size="sm"
                    />
                    <span className="truncate">
                      {line.quantity}× {line.name}
                      {line.size ? ` — ${line.size}` : ""}
                    </span>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-text-secondary">
                      {formatMoney(String(Number(line.salePrice ?? 0) * line.quantity))}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remover ${line.name}`}
                      onClick={() =>
                        setLines((current) => current.filter((_, position) => position !== index))
                      }
                      className="rounded p-2 text-text-muted hover:bg-background-secondary"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mb-4 flex items-baseline justify-between border-t border-border pt-4">
            <span className="text-text-secondary">Total</span>
            <span className="text-xl font-semibold text-text-primary">
              {formatMoney(String(total))}
            </span>
          </div>

          <div className="flex gap-3">
            <Button type="submit" disabled={lines.length === 0 || create.isPending}>
              Salvar orçamento
            </Button>
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
          </div>

          <p className="mt-4 text-sm text-text-secondary">
            Vale por 15 dias. Depois disso os preços são recalculados — prata oscila, e prometer
            um valor por tempo indefinido é prejuízo da loja.
          </p>
        </form>
      )}

      <ul className="space-y-3">
        {quotes.data?.map((quote) => (
          <li
            key={quote.id}
            className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-surface p-5"
          >
            <div className="flex items-start gap-3">
              <FileText className="mt-1 h-5 w-5 text-text-secondary" aria-hidden />
              <div>
                <p className="font-medium text-text-primary">
                  {quote.code} · {quote.customer?.name ?? quote.customerName}
                </p>
                <p className="text-sm text-text-secondary">
                  {quote.store.name} · vale até {formatDate(quote.validUntil)} ·{" "}
                  {quote.items.length} item(ns)
                </p>
                <span
                  className={`mt-2 inline-block rounded px-2 py-0.5 text-sm ${STATUS_STYLES[quote.status]}`}
                >
                  {STATUS_LABELS[quote.status]}
                </span>
              </div>
            </div>

            <span className="text-lg font-semibold text-text-primary">
              {formatMoney(quote.totalAmount)}
            </span>
          </li>
        ))}
      </ul>

      {quotes.data?.length === 0 && !creating && (
        <Alert tone="info">Nenhum orçamento registrado.</Alert>
      )}
    </PageShell>
  );
}
