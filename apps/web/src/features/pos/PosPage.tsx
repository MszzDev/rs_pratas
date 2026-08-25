import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, ChevronDown, Minus, Plus, Search, ShoppingCart, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ProductPhoto } from "@/components/ui/product-photo";
import { formatMoney } from "@/lib/money";
import { PaymentDialog } from "./PaymentDialog";
import type { CartLine, StockRow } from "./types";
import { groupByProduct } from "./group-stock";
import { StorePicker } from "../stores/store-picker";
import { useBarcodeScanner } from "./use-barcode-scanner";

interface Reservation {
  id: string;
  code: string;
  status: string;
  diasRestantes: number | null;
  customer: { name: string; phone: string };
}

/**
 * PDV — aba de Venda.
 *
 * O carrinho vive aqui, na tela, e não no banco: um rascunho persistido criaria
 * a pergunta de quando devolver ao estoque o carrinho que ninguém fechou, e a
 * resposta errada trava peça que nunca foi vendida.
 *
 * Os preços exibidos vêm do estoque (que os traz do catálogo) e servem só para
 * o vendedor conferir com o cliente. Quem decide quanto custa é o servidor, no
 * momento de fechar — a tela nunca manda preço.
 */
export function PosPage() {
  const queryClient = useQueryClient();

  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<{ code: string; total: string } | null>(null);
  /** Peça com os tamanhos abertos. Uma de cada vez: duas listas abertas viram rolagem. */
  const [tamanhosAbertos, setTamanhosAbertos] = useState<string | null>(null);

  /** Turno aberto da loja escolhida — sem ele não há venda. */
  const session = useQuery({
    queryKey: ["cash-open-session", storeId],
    queryFn: () =>
      apiFetch<Array<{ id: string; code: string; cashRegister: { name: string } }>>(
        `/api/v1/cash/sessions?storeId=${storeId}&status=ABERTO`,
      ),
    enabled: storeId !== "",
  });

  const openSession = session.data?.[0];

  const stock = useQuery({
    queryKey: ["pos-stock", storeId, search],
    queryFn: () =>
      apiFetch<StockRow[]>(
        `/api/v1/stock?storeId=${storeId}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      ),
    enabled: storeId !== "",
  });

  /**
   * Reservas aparecem aqui como aviso de andamento, não como aba separada —
   * é o que o vendedor precisa saber sem sair da tela de venda.
   */
  const reservations = useQuery({
    queryKey: ["reservations", storeId, "ATIVA"],
    queryFn: () =>
      apiFetch<Reservation[]>(`/api/v1/reservations?storeId=${storeId}&status=ATIVA`),
    enabled: storeId !== "",
  });

  const grupos = useMemo(() => groupByProduct(stock.data ?? []), [stock.data]);

  const subtotal = useMemo(
    () => cart.reduce((sum, line) => sum + Number(line.salePrice ?? 0) * line.quantity, 0),
    [cart],
  );

  function addToCart(row: StockRow) {
    setError(null);
    setTamanhosAbertos(null);

    const existing = cart.find((line) => line.stockItemId === row.id);
    const alreadyInCart = existing?.quantity ?? 0;

    if (alreadyInCart + 1 > row.availableQuantity) {
      setError(
        `Só há ${row.availableQuantity} peça(s) disponível(is) de ${row.name}${
          row.reservedQuantity > 0 ? " — o resto está reservado para outro cliente" : ""
        }.`,
      );
      return;
    }

    setCart((current) =>
      existing
        ? current.map((line) =>
            line.stockItemId === row.id ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [
            ...current,
            {
              stockItemId: row.id,
              productId: row.productId,
              variationId: row.variationId,
              name: row.name,
              size: row.size,
              sku: row.sku,
              salePrice: row.salePrice,
              imageChecksum: row.imageChecksum,
              imageExternalUrl: row.imageExternalUrl,
              available: row.availableQuantity,
              quantity: 1,
            },
          ],
    );
  }

  function changeQuantity(stockItemId: string, delta: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.stockItemId === stockItemId
            ? { ...line, quantity: Math.min(line.available, line.quantity + delta) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  const quickCustomer = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; name: string }>("/api/v1/customers/quick", {
        method: "POST",
        body: { name: customerName.trim(), phone: customerPhone.replace(/\D/g, "") },
      }),
    onSuccess: (result) => {
      setCustomer(result);
      setError(null);
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível salvar o cliente."),
  });

  function onSaleCompleted(sale: { code: string; totalAmount: string }) {
    setLastSale({ code: sale.code, total: sale.totalAmount });
    setCart([]);
    setCustomer(null);
    setCustomerName("");
    setCustomerPhone("");
    setPaying(false);
    void queryClient.invalidateQueries({ queryKey: ["pos-stock"] });
    void queryClient.invalidateQueries({ queryKey: ["reservations"] });
  }

  /**
   * Leitura do código de barras da etiqueta.
   *
   * Casa pelo código EXATO, e não pela busca: o leitor entrega o código
   * inteiro, e uma correspondência parcial poderia colocar no carrinho a peça
   * errada — quem bipa confia no som e não confere a tela.
   *
   * Sem correspondência, o código cai na busca junto com o aviso. Assim o
   * vendedor VÊ o que foi lido, em vez de bipar e nada acontecer.
   */
  useBarcodeScanner((codigo) => {
    const lido = codigo.trim();
    const linha = (stock.data ?? []).find((row) => row.sku.toUpperCase() === lido.toUpperCase());

    if (linha) {
      addToCart(linha);
      setSearch("");
      return;
    }

    setSearch(lido);
    setError("Nenhuma peça com o código " + lido + ".");
  });

  return (
    <PageShell title="Venda" description="Monte o carrinho e finalize no caixa aberto da loja.">
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {lastSale && (
        <div className="mb-5">
          <Alert tone="success" title={`Venda ${lastSale.code} concluída`}>
            <div className="flex flex-wrap items-center gap-3">
              <span>Total de {formatMoney(lastSale.total)}.</span>
              <Button type="button" variant="ghost" onClick={() => setLastSale(null)}>
                Fechar
              </Button>
            </div>
          </Alert>
        </div>
      )}

      <StorePicker
        storeId={storeId}
        onChange={(id) => {
          setStoreId(id);
          setCart([]);
        }}
      />

      {storeId && !openSession && !session.isLoading && (
        <Alert tone="error" title="Caixa fechado">
          Nenhum caixa está aberto nesta loja. Abra o caixa antes de vender — sem turno aberto a
          venda não entra em fechamento nenhum.
        </Alert>
      )}

      {storeId && (reservations.data?.length ?? 0) > 0 && (
        <div className="mb-5">
          <Alert tone="info" title="Reservas aguardando retirada">
            <ul className="mt-1 space-y-1">
              {reservations.data?.map((reservation) => (
                <li key={reservation.id} className="flex items-center gap-2">
                  <Bell className="h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    {reservation.customer.name} · {reservation.code} ·{" "}
                    {reservation.diasRestantes !== null && reservation.diasRestantes <= 1
                      ? "vence hoje"
                      : `${reservation.diasRestantes} dia(s) restante(s)`}
                  </span>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      {storeId && openSession && (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          {/* Busca de peças */}
          <div>
            <div className="mb-4">
              <Field
                label="Buscar peça"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome ou código — ou bipe a etiqueta"
              />
            </div>

            <ul className="space-y-2">
              {grupos.map((grupo) => {
                const aberto = tamanhosAbertos === grupo.productId;
                const unico = grupo.variacoes[0];

                return (
                  <li key={grupo.productId}>
                    <button
                      type="button"
                      onClick={() => {
                        // Peça sem tamanho vai direto ao carrinho; com tamanho,
                        // abre a escolha. Um toque a mais só onde ele decide
                        // alguma coisa.
                        if (!grupo.temTamanhos && unico) {
                          addToCart(unico);
                          return;
                        }
                        setTamanhosAbertos(aberto ? null : grupo.productId);
                      }}
                      disabled={grupo.disponivelTotal === 0}
                      aria-expanded={grupo.temTamanhos ? aberto : undefined}
                      className="flex w-full min-h-[64px] items-center justify-between gap-4 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-rose-primary disabled:opacity-50"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductPhoto
                          productId={grupo.productId}
                          checksum={grupo.imageChecksum}
                          externalUrl={grupo.imageExternalUrl}
                          alt={grupo.name}
                          size="md"
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-text-primary">{grupo.name}</p>
                          <p className="text-sm text-text-secondary">
                            {grupo.sku} · {grupo.disponivelTotal} disponível(is)
                            {grupo.temTamanhos
                              ? ` em ${grupo.variacoes.length} tamanho(s)`
                              : ""}
                            {grupo.reservadoTotal > 0
                              ? ` · ${grupo.reservadoTotal} reservada(s)`
                              : ""}
                          </p>
                        </div>
                      </div>

                      <span className="flex shrink-0 items-center gap-2 font-medium text-text-primary">
                        {/* Faixa de preço só quando os tamanhos custam
                            diferente — anel 30 leva mais prata que o 12. */}
                        {grupo.precoMin === grupo.precoMax
                          ? formatMoney(String(grupo.precoMin))
                          : `${formatMoney(String(grupo.precoMin))} a ${formatMoney(String(grupo.precoMax))}`}
                        {grupo.temTamanhos && (
                          <ChevronDown
                            className={`h-4 w-4 text-text-muted transition-transform ${aberto ? "rotate-180" : ""}`}
                            aria-hidden
                          />
                        )}
                      </span>
                    </button>

                    {/* Escolha do tamanho: botões grandes, porque no tablet
                        isso é tocado com o dedo e o cliente está esperando. */}
                    {grupo.temTamanhos && aberto && (
                      <div className="mt-1 flex flex-wrap gap-2 rounded-lg border border-border/70 bg-background-secondary p-3">
                        {grupo.variacoes.map((variacao) => (
                          <button
                            key={variacao.id}
                            type="button"
                            disabled={variacao.availableQuantity === 0}
                            onClick={() => addToCart(variacao)}
                            className="flex min-h-[52px] min-w-[68px] flex-col items-center justify-center rounded-md border border-border bg-surface px-3 text-sm transition-colors hover:border-rose-primary disabled:opacity-40"
                          >
                            <span className="font-medium text-text-primary">{variacao.size}</span>
                            <span className="text-xs text-text-muted">
                              {variacao.availableQuantity === 0
                                ? "esgotado"
                                : `${variacao.availableQuantity} un.`}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {grupos.length === 0 && (
              <Alert tone="info">
                <span className="flex items-center gap-2">
                  <Search className="h-4 w-4" aria-hidden />
                  Nenhuma peça encontrada nesta loja.
                </span>
              </Alert>
            )}
          </div>

          {/* Carrinho */}
          <aside className="rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-6 lg:self-start">
            <h2 className="mb-4 flex items-center gap-2 font-medium text-text-primary">
              <ShoppingCart className="h-5 w-5" aria-hidden />
              Carrinho
            </h2>

            {cart.length === 0 && (
              <p className="text-sm text-text-muted">Toque numa peça para adicionar.</p>
            )}

            <ul className="space-y-3">
              {cart.map((line) => (
                <li key={line.stockItemId} className="border-b border-border pb-3 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <ProductPhoto
                        productId={line.productId}
                        checksum={line.imageChecksum}
                        externalUrl={line.imageExternalUrl}
                        alt={line.name}
                        size="sm"
                      />
                      <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {line.name}
                        {line.size ? ` — ${line.size}` : ""}
                      </p>
                      <p className="text-sm text-text-secondary">
                        {formatMoney(line.salePrice)} cada
                      </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remover ${line.name}`}
                      onClick={() => changeQuantity(line.stockItemId, -line.quantity)}
                      className="shrink-0 rounded p-2 text-text-muted hover:bg-background-secondary"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Diminuir"
                      onClick={() => changeQuantity(line.stockItemId, -1)}
                      className="flex h-11 w-11 items-center justify-center rounded-md border border-border"
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </button>
                    <span className="w-8 text-center font-medium">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label="Aumentar"
                      onClick={() => changeQuantity(line.stockItemId, 1)}
                      disabled={line.quantity >= line.available}
                      className="flex h-11 w-11 items-center justify-center rounded-md border border-border disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </button>
                    <span className="ml-auto font-medium text-text-primary">
                      {formatMoney(String(Number(line.salePrice ?? 0) * line.quantity))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Cliente */}
            <div className="mt-5 border-t border-border pt-5">
              {customer ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-text-primary">
                    Cliente: <strong>{customer.name}</strong>
                  </p>
                  <button
                    type="button"
                    aria-label="Remover cliente"
                    onClick={() => setCustomer(null)}
                    className="rounded p-2 text-text-muted hover:bg-background-secondary"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field
                    label="Nome do cliente"
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                  />
                  <Field
                    label="Telefone"
                    inputMode="tel"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    hint="Com DDD. Se já for cliente, o cadastro é reaproveitado."
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      customerName.trim().length < 2 ||
                      customerPhone.replace(/\D/g, "").length < 10 ||
                      quickCustomer.isPending
                    }
                    onClick={() => quickCustomer.mutate()}
                  >
                    Vincular cliente
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-5 border-t border-border pt-5">
              <div className="mb-4 flex items-baseline justify-between">
                <span className="text-text-secondary">Total</span>
                <span className="text-2xl font-semibold text-text-primary">
                  {formatMoney(String(subtotal))}
                </span>
              </div>

              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={cart.length === 0}
                onClick={() => setPaying(true)}
              >
                Ir para o pagamento
              </Button>
            </div>
          </aside>
        </div>
      )}

      {paying && openSession && (
        <PaymentDialog
          storeId={storeId}
          sessionId={openSession.id}
          cart={cart}
          customerId={customer?.id ?? null}
          total={subtotal}
          onClose={() => setPaying(false)}
          onCompleted={onSaleCompleted}
        />
      )}
    </PageShell>
  );
}
