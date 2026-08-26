import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";

interface ReturnableInfo {
  saleId: string;
  code: string;
  diasDesdeVenda: number;
  dentroDoPrazo: boolean;
  prazoEmDias: number;
  items: Array<{
    saleItemId: string;
    productName: string;
    productSku: string;
    quantidadeVendida: number;
    quantidadeDevolvida: number;
    quantidadeDisponivel: number;
    valorPorPeca: string | null;
  }>;
}

interface ReturnRow {
  id: string;
  code: string;
  type: "DEVOLUCAO" | "TROCA";
  refundAmount: string | null;
  reason: string;
  createdAt: string;
  store: { name: string };
  originalSale: { code: string; customer: { name: string } | null };
  items: Array<{ quantity: number; saleItem: { productName: string } }>;
}

interface WarrantyInfo {
  id: string;
  code: string;
  months: number;
  startsAt: string;
  expiresAt: string;
  vigente: boolean;
  diasRestantes: number;
  terms: string;
  saleItem: {
    productName: string;
    productSku: string;
    sale: { code: string; customer: { name: string; phone: string } | null };
  };
  claims: Array<{
    id: string;
    description: string;
    approved: boolean | null;
    decisionReason: string | null;
    createdAt: string;
  }>;
}

interface SaleRow {
  id: string;
  code: string;
  totalAmount: string | null;
  completedAt: string | null;
  customer: { name: string } | null;
}

interface SessionRow {
  id: string;
  code: string;
  storeId: string;
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

/**
 * Pós-venda: trocas, devoluções e garantias.
 *
 * A devolução sai do caixa de HOJE, não do turno da venda original — por isso
 * a tela exige escolher o turno aberto antes de concluir.
 */
export function AfterSalesPage() {
  const queryClient = useQueryClient();

  /**
   * A tela de triagem manda o caso já classificado.
   *
   * "Cliente voltou com uma peça" pergunta o que houve em português e
   * traduz para os conceitos do sistema. Chegando aqui com a aba e o tipo
   * já escolhidos, a vendedora não precisa acertar a tradução de novo — que
   * era justamente onde ela errava, e errar ali custa dinheiro.
   */
  const [searchParams] = useSearchParams();
  const abaPedida = searchParams.get("aba") === "garantia" ? "garantia" : "devolucao";
  const tipoPedido = searchParams.get("tipo") === "TROCA" ? "TROCA" : "DEVOLUCAO";

  const [tab, setTab] = useState<"devolucao" | "garantia">(abaPedida);
  const [error, setError] = useState<string | null>(null);

  // --- devolução
  const [saleSearch, setSaleSearch] = useState("");
  const [selectedSale, setSelectedSale] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [type, setType] = useState<"DEVOLUCAO" | "TROCA">(tipoPedido);
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});

  // --- garantia
  const [warrantyCode, setWarrantyCode] = useState("");
  const [lookupCode, setLookupCode] = useState("");

  const sales = useQuery({
    queryKey: ["sales"],
    queryFn: () => apiFetch<SaleRow[]>("/api/v1/sales"),
  });

  const openSessions = useQuery({
    queryKey: ["cash-sessions", "ABERTO"],
    queryFn: () => apiFetch<SessionRow[]>("/api/v1/cash/sessions?status=ABERTO"),
  });

  const [certificadoEmitido, setCertificadoEmitido] = useState<string | null>(null);

  const returnable = useQuery({
    queryKey: ["returnable", selectedSale],
    queryFn: () => apiFetch<ReturnableInfo>(`/api/v1/sales/${selectedSale}/returnable`),
    enabled: selectedSale !== null,
  });

  const returns = useQuery({
    queryKey: ["returns"],
    queryFn: () => apiFetch<ReturnRow[]>("/api/v1/returns"),
  });

  const warranty = useQuery({
    queryKey: ["warranty", lookupCode],
    queryFn: () => apiFetch<WarrantyInfo>(`/api/v1/warranties/${lookupCode}`),
    enabled: lookupCode !== "",
    retry: false,
  });

  const createReturn = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/returns", {
        method: "POST",
        body: {
          originalSaleId: selectedSale,
          sessionId,
          type,
          reason,
          items: Object.entries(quantities)
            .filter(([, quantity]) => quantity > 0)
            .map(([saleItemId, quantity]) => ({
              saleItemId,
              quantity,
              ...(damaged[saleItemId] ? { returnedToStock: false } : {}),
            })),
        },
      }),
    onSuccess: () => {
      setError(null);
      setSelectedSale(null);
      setQuantities({});
      setDamaged({});
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["returns"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível concluir."),
  });

  const filteredSales = (sales.data ?? []).filter(
    (sale) =>
      !saleSearch ||
      sale.code.toLowerCase().includes(saleSearch.toLowerCase()) ||
      sale.customer?.name.toLowerCase().includes(saleSearch.toLowerCase()),
  );

  /**
   * Certificado de prata 925 da peça.
   *
   * Emitido a partir do ITEM da venda, e não do produto: o certificado é
   * daquela peça que aquela pessoa levou, com código próprio. Sair daqui é o
   * caminho natural — é a tela em que a venda já está aberta na frente de quem
   * atende, com a peça na mão.
   */
  const emitirCertificado = useMutation({
    mutationFn: (saleItemId: string) =>
      apiFetch<{ code: string }>("/api/v1/certificates", {
        method: "POST",
        body: { saleItemId },
      }),
    onSuccess: (certificado) => {
      setError(null);
      setCertificadoEmitido(certificado.code);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError ? caught.message : "Não foi possível emitir o certificado.",
      ),
  });

  const totalToRefund = (returnable.data?.items ?? []).reduce(
    (sum, item) => sum + Number(item.valorPorPeca ?? 0) * (quantities[item.saleItemId] ?? 0),
    0,
  );

  return (
    <PageShell
      title="Pós-venda"
      description="Trocas, devoluções e garantias. A devolução sai do caixa de hoje, não do turno da venda."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mb-6 flex gap-2" role="tablist">
        <Button
          type="button"
          variant={tab === "devolucao" ? "primary" : "outline"}
          onClick={() => setTab("devolucao")}
        >
          <RotateCcw className="h-5 w-5" aria-hidden />
          Troca e devolução
        </Button>
        <Button
          type="button"
          variant={tab === "garantia" ? "primary" : "outline"}
          onClick={() => setTab("garantia")}
        >
          <ShieldCheck className="h-5 w-5" aria-hidden />
          Garantia
        </Button>
      </div>

      {tab === "devolucao" && (
        <>
          {!selectedSale && (
            <>
              <div className="mb-4 max-w-md">
                <Field
                  label="Buscar a venda"
                  value={saleSearch}
                  onChange={(event) => setSaleSearch(event.target.value)}
                  placeholder="Código da venda ou nome do cliente"
                />
              </div>

              <ul className="mb-8 space-y-2">
                {filteredSales.slice(0, 20).map((sale) => (
                  <li key={sale.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedSale(sale.id)}
                      className="flex w-full min-h-[56px] items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4 text-left hover:border-rose-primary"
                    >
                      <div>
                        <p className="font-medium text-text-primary">
                          {sale.code}
                          {sale.customer ? ` · ${sale.customer.name}` : ""}
                        </p>
                        <p className="text-sm text-text-secondary">
                          {formatDate(sale.completedAt)}
                        </p>
                      </div>
                      <span className="font-medium text-text-primary">
                        {formatMoney(sale.totalAmount)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {certificadoEmitido && (
        <div className="mb-5">
          <Alert tone="success" title={`Certificado ${certificadoEmitido} emitido`}>
            Anote o código no certificado impresso. Ele identifica esta peça e este cliente.
          </Alert>
        </div>
      )}

      {selectedSale && returnable.data && (
            <form
              className="mb-8 rounded-lg border border-border bg-surface p-5"
              onSubmit={(event) => {
                event.preventDefault();
                createReturn.mutate();
              }}
            >
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium text-text-primary">
                    Venda {returnable.data.code}
                  </h2>
                  <p className="text-sm text-text-secondary">
                    Comprada há {returnable.data.diasDesdeVenda} dia(s)
                  </p>
                </div>
                <Button type="button" variant="ghost" onClick={() => setSelectedSale(null)}>
                  Trocar de venda
                </Button>
              </div>

              {!returnable.data.dentroDoPrazo && (
                <div className="mb-4">
                  <Alert tone="error" title="Fora do prazo">
                    Passou dos {returnable.data.prazoEmDias} dias. Só o responsável pode autorizar.
                  </Alert>
                </div>
              )}

              <ul className="mb-5 space-y-3">
                {returnable.data.items.map((item) => (
                  <li key={item.saleItemId} className="border-b border-border pb-3 last:border-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-text-primary">{item.productName}</p>
                        <p className="text-sm text-text-secondary">
                          {item.productSku} · {formatMoney(item.valorPorPeca)} por peça ·{" "}
                          {item.quantidadeDisponivel} de {item.quantidadeVendida} disponível(is)
                        </p>
                      </div>

                      <div className="flex items-end gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={emitirCertificado.isPending}
                          onClick={() => emitirCertificado.mutate(item.saleItemId)}
                        >
                          <BadgeCheck className="h-4 w-4" aria-hidden />
                          Certificado
                        </Button>

                        <Field
                          label="Devolver"
                          type="number"
                          min={0}
                          max={item.quantidadeDisponivel}
                          className="w-24"
                          value={String(quantities[item.saleItemId] ?? 0)}
                          onChange={(event) =>
                            setQuantities({
                              ...quantities,
                              [item.saleItemId]: Math.min(
                                item.quantidadeDisponivel,
                                Number(event.target.value),
                              ),
                            })
                          }
                        />
                      </div>
                    </div>

                    {(quantities[item.saleItemId] ?? 0) > 0 && (
                      <label className="mt-2 flex min-h-[44px] items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-rose-primary"
                          checked={Boolean(damaged[item.saleItemId])}
                          onChange={(event) =>
                            setDamaged({ ...damaged, [item.saleItemId]: event.target.checked })
                          }
                        />
                        Peça danificada — não volta para a prateleira
                      </label>
                    )}
                  </li>
                ))}
              </ul>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    className="mb-1 block text-sm font-medium text-text-primary"
                    htmlFor="tipo"
                  >
                    O que vai acontecer
                  </label>
                  <select
                    id="tipo"
                    value={type}
                    onChange={(event) =>
                      setType(event.target.value as "DEVOLUCAO" | "TROCA")
                    }
                    className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
                  >
                    <option value="DEVOLUCAO">Devolução — dinheiro de volta</option>
                    <option value="TROCA">Troca — vira crédito para outra peça</option>
                  </select>
                </div>

                <div>
                  <label
                    className="mb-1 block text-sm font-medium text-text-primary"
                    htmlFor="turno"
                  >
                    Caixa aberto
                  </label>
                  <select
                    id="turno"
                    required
                    value={sessionId}
                    onChange={(event) => setSessionId(event.target.value)}
                    className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
                  >
                    <option value="">Selecione</option>
                    {openSessions.data?.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.code}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <Field
                    label="Motivo"
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    hint="Fica registrado na auditoria."
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                <span className="text-lg font-medium text-text-primary">
                  {type === "DEVOLUCAO" ? "A devolver" : "Crédito"}:{" "}
                  {formatMoney(String(totalToRefund))}
                </span>

                <Button
                  type="submit"
                  disabled={totalToRefund === 0 || !sessionId || createReturn.isPending}
                >
                  Concluir
                </Button>
              </div>
            </form>
          )}

          <h2 className="mb-3 font-medium text-text-primary">Devoluções recentes</h2>
          <ul className="space-y-3">
            {returns.data?.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-surface p-5"
              >
                <div>
                  <p className="font-medium text-text-primary">
                    {row.code} · {row.type === "TROCA" ? "Troca" : "Devolução"} da venda{" "}
                    {row.originalSale.code}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {row.originalSale.customer?.name ?? "sem cliente"} ·{" "}
                    {row.items.map((item) => `${item.quantity}× ${item.saleItem.productName}`).join(", ")}
                  </p>
                  <p className="mt-1 text-sm text-text-muted">“{row.reason}”</p>
                </div>
                <span className="font-medium text-text-primary">
                  {formatMoney(row.refundAmount)}
                </span>
              </li>
            ))}
          </ul>

          {returns.data?.length === 0 && (
            <Alert tone="info">Nenhuma devolução registrada.</Alert>
          )}
        </>
      )}

      {tab === "garantia" && (
        <>
          <form
            className="mb-6 flex max-w-md items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setLookupCode(warrantyCode.trim().toUpperCase());
            }}
          >
            <div className="flex-1">
              <Field
                label="Código da garantia"
                value={warrantyCode}
                onChange={(event) => setWarrantyCode(event.target.value)}
                placeholder="GA000001"
              />
            </div>
            <Button type="submit">
              <Search className="h-5 w-5" aria-hidden />
              Consultar
            </Button>
          </form>

          {warranty.isError && (
            <Alert tone="error">Garantia não encontrada com esse código.</Alert>
          )}

          {warranty.data && (
            <div className="rounded-lg border border-border bg-surface p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium text-text-primary">
                    {warranty.data.saleItem.productName}
                  </h2>
                  <p className="text-sm text-text-secondary">
                    Venda {warranty.data.saleItem.sale.code}
                    {warranty.data.saleItem.sale.customer
                      ? ` · ${warranty.data.saleItem.sale.customer.name}`
                      : ""}
                  </p>
                </div>

                <span
                  className={`rounded px-3 py-1 text-sm ${
                    warranty.data.vigente
                      ? "bg-success/10 text-success"
                      : "bg-danger/10 text-danger"
                  }`}
                >
                  {warranty.data.vigente
                    ? `Vigente · ${warranty.data.diasRestantes} dia(s)`
                    : `Vencida em ${formatDate(warranty.data.expiresAt)}`}
                </span>
              </div>

              <dl className="mb-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-sm text-text-secondary">Prazo</dt>
                  <dd className="font-medium">{warranty.data.months} meses</dd>
                </div>
                <div>
                  <dt className="text-sm text-text-secondary">Início</dt>
                  <dd className="font-medium">{formatDate(warranty.data.startsAt)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-text-secondary">Fim</dt>
                  <dd className="font-medium">{formatDate(warranty.data.expiresAt)}</dd>
                </div>
              </dl>

              <details className="mb-4">
                <summary className="cursor-pointer text-sm font-medium text-text-primary">
                  Termos da garantia
                </summary>
                <p className="mt-2 text-sm text-text-secondary">{warranty.data.terms}</p>
              </details>

              {warranty.data.claims.length > 0 && (
                <div className="border-t border-border pt-4">
                  <h3 className="mb-2 text-sm font-medium text-text-primary">Acionamentos</h3>
                  <ul className="space-y-2 text-sm">
                    {warranty.data.claims.map((claim) => (
                      <li key={claim.id}>
                        <span className="text-text-primary">{claim.description}</span>
                        <span className="ml-2 text-text-muted">
                          {claim.approved === null
                            ? "· aguardando decisão"
                            : claim.approved
                              ? "· coberto"
                              : `· recusado: ${claim.decisionReason}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
