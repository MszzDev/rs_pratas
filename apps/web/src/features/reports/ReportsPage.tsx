import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Target, TrendingUp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";

interface Summary {
  vendas: number;
  pecas: number;
  faturamento: string | null;
  descontoConcedido: string | null;
  custo: string | null;
  margem: string | null;
  margemPercentual: string | null;
  ticketMedio: string | null;
}

interface SellerRow {
  sellerId: string;
  nome: string;
  matricula: string;
  vendas: number;
  faturamento: string | null;
  ticketMedio: string | null;
}

interface ProductRow {
  productId: string;
  nome: string;
  sku: string;
  pecasVendidas: number;
  faturamento: string | null;
}

interface PaymentRow {
  metodo: string;
  transacoes: number;
  total: string | null;
}

interface GoalRow {
  id: string;
  loja: string;
  escopo: string;
  vendedor: string | null;
  meta: string | null;
  realizado: string | null;
  percentual: string;
  atingida: boolean;
  falta: string | null;
}

interface CashDifferences {
  turnosFechados: number;
  turnosComDiferenca: number;
  diferencaAcumulada: string | null;
  turnos: Array<{
    code: string;
    loja: string;
    caixa: string;
    fechadoPor: string;
    contado: string | null;
    esperado: string | null;
    diferenca: string | null;
    motivo: string | null;
  }>;
}

interface StoreRow {
  id: string;
  name: string;
}

const PAYMENT_LABELS: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "PIX",
  DEBITO: "Débito",
  CREDITO: "Crédito",
  CREDITO_PARCELADO: "Crédito parcelado",
  TRANSFERENCIA: "Transferência",
  CREDIARIO: "Crediário",
};

/**
 * Últimos N dias, ancorados nas bordas do dia.
 *
 * O arredondamento não é cosmético: o intervalo entra na chave da consulta, e
 * um valor com precisão de milissegundo mudaria a cada render, fazendo o
 * React Query refazer a busca sem parar.
 */
function lastDays(days: number) {
  const to = new Date();
  to.setHours(23, 59, 59, 999);

  const from = new Date(to);
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);

  return { from: from.toISOString(), to: to.toISOString() };
}

export function ReportsPage() {
  const [days, setDays] = useState(30);
  const [storeId, setStoreId] = useState("");

  const query = useMemo(() => {
    const range = lastDays(days);
    return `from=${range.from}&to=${range.to}${storeId ? `&storeId=${storeId}` : ""}`;
  }, [days, storeId]);

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<StoreRow[]>("/api/v1/stores"),
  });

  const summary = useQuery({
    queryKey: ["report-summary", query],
    queryFn: () => apiFetch<Summary>(`/api/v1/reports/sales-summary?${query}`),
  });

  const sellers = useQuery({
    queryKey: ["report-sellers", query],
    queryFn: () => apiFetch<SellerRow[]>(`/api/v1/reports/sales-by-seller?${query}`),
  });

  const products = useQuery({
    queryKey: ["report-products", query],
    queryFn: () => apiFetch<ProductRow[]>(`/api/v1/reports/top-products?${query}&limit=10`),
  });

  const payments = useQuery({
    queryKey: ["report-payments", query],
    queryFn: () => apiFetch<PaymentRow[]>(`/api/v1/reports/payments?${query}`),
  });

  const goals = useQuery({
    queryKey: ["goals", storeId],
    queryFn: () =>
      apiFetch<GoalRow[]>(
        `/api/v1/goals?activeOnly=true${storeId ? `&storeId=${storeId}` : ""}`,
      ),
  });

  /**
   * Diferenças de caixa exigem a permissão de fechamento. Quem não tem recebe
   * 403 — a tela simplesmente não mostra o bloco em vez de exibir um erro.
   */
  const differences = useQuery({
    queryKey: ["report-cash", query],
    queryFn: () => apiFetch<CashDifferences>(`/api/v1/reports/cash-differences?${query}`),
    retry: false,
  });

  return (
    <PageShell
      title="Relatórios"
      description="Tudo calculado a partir das vendas concluídas — não de saldos acumulados."
    >
      <div className="mb-6 flex flex-wrap gap-4">
        <div className="min-w-[10rem]">
          <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="periodo">
            Período
          </label>
          <select
            id="periodo"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={365}>Último ano</option>
          </select>
        </div>

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
      </div>

      {summary.data && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Faturamento" value={formatMoney(summary.data.faturamento)} />
          <Card
            label="Margem"
            value={formatMoney(summary.data.margem)}
            hint={summary.data.margemPercentual ? `${summary.data.margemPercentual}%` : undefined}
          />
          <Card label="Vendas" value={String(summary.data.vendas)} hint={`${summary.data.pecas} peças`} />
          <Card label="Ticket médio" value={formatMoney(summary.data.ticketMedio)} />
        </div>
      )}

      {goals.data && goals.data.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 font-medium text-text-primary">
            <Target className="h-5 w-5" aria-hidden />
            Metas em andamento
          </h2>

          <ul className="space-y-3">
            {goals.data.map((goal) => (
              <li key={goal.id} className="rounded-lg border border-border bg-surface p-5">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-text-primary">
                    {goal.vendedor ?? goal.loja}
                  </span>
                  <span className="text-sm text-text-secondary">
                    {formatMoney(goal.realizado)} de {formatMoney(goal.meta)}
                    {goal.atingida ? " · batida" : ` · faltam ${formatMoney(goal.falta)}`}
                  </span>
                </div>

                <div
                  className="h-2 overflow-hidden rounded-full bg-border"
                  role="progressbar"
                  aria-valuenow={Math.min(100, Number(goal.percentual))}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Progresso da meta de ${goal.vendedor ?? goal.loja}`}
                >
                  <div
                    className={`h-full ${goal.atingida ? "bg-success" : "bg-rose-primary"}`}
                    style={{ width: `${Math.min(100, Number(goal.percentual))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-medium text-text-primary">
            <TrendingUp className="h-5 w-5" aria-hidden />
            Por vendedor
          </h2>

          <ul className="space-y-2">
            {sellers.data?.map((seller) => (
              <li
                key={seller.sellerId}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4"
              >
                <div>
                  <p className="font-medium text-text-primary">{seller.nome}</p>
                  <p className="text-sm text-text-secondary">
                    {seller.vendas} venda(s) · ticket {formatMoney(seller.ticketMedio)}
                  </p>
                </div>
                <span className="font-medium text-text-primary">
                  {formatMoney(seller.faturamento)}
                </span>
              </li>
            ))}
          </ul>

          {sellers.data?.length === 0 && (
            <Alert tone="info">Nenhuma venda no período.</Alert>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-medium text-text-primary">Peças que mais saem</h2>

          <ul className="space-y-2">
            {products.data?.map((product) => (
              <li
                key={product.productId}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4"
              >
                <div>
                  <p className="font-medium text-text-primary">{product.nome}</p>
                  <p className="text-sm text-text-secondary">{product.sku}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-text-primary">{product.pecasVendidas} peças</p>
                  <p className="text-sm text-text-secondary">
                    {formatMoney(product.faturamento)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-medium text-text-primary">Como o dinheiro entrou</h2>

          <ul className="space-y-2">
            {payments.data?.map((payment) => (
              <li
                key={payment.metodo}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4"
              >
                <span className="text-text-primary">
                  {PAYMENT_LABELS[payment.metodo] ?? payment.metodo}
                  <span className="ml-2 text-sm text-text-secondary">
                    {payment.transacoes} transação(ões)
                  </span>
                </span>
                <span className="font-medium text-text-primary">{formatMoney(payment.total)}</span>
              </li>
            ))}
          </ul>
        </section>

        {differences.data && (
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-medium text-text-primary">
              <AlertTriangle className="h-5 w-5" aria-hidden />
              Caixas que não bateram
            </h2>

            <p className="mb-3 text-sm text-text-secondary">
              {differences.data.turnosComDiferenca} de {differences.data.turnosFechados} turnos ·
              diferença acumulada de {formatMoney(differences.data.diferencaAcumulada)}
            </p>

            <ul className="space-y-2">
              {differences.data.turnos.map((turno) => (
                <li key={turno.code} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-text-primary">
                      {turno.code} · {turno.loja} — {turno.caixa}
                    </span>
                    <span className="font-medium text-danger">
                      {formatMoney(turno.diferenca)}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary">
                    Fechado por {turno.fechadoPor} · contou {formatMoney(turno.contado)}, esperado{" "}
                    {formatMoney(turno.esperado)}
                  </p>
                  {turno.motivo && (
                    <p className="mt-1 text-sm text-text-muted">“{turno.motivo}”</p>
                  )}
                </li>
              ))}
            </ul>

            {differences.data.turnos.length === 0 && (
              <Alert tone="success">Todos os caixas fecharam certos no período.</Alert>
            )}
          </section>
        )}
      </div>
    </PageShell>
  );
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-primary">{value}</p>
      {hint && <p className="mt-1 text-sm text-text-muted">{hint}</p>}
    </div>
  );
}
