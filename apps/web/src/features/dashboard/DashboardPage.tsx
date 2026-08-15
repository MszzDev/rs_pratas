import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  DoorClosed,
  DoorOpen,
  Gem,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, CardBody, CardHeader, MetricCard } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { BarList, DonutChart, TrendChart } from "@/components/charts/charts";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";

interface StoreStatus {
  id: string;
  name: string;
  isOpen: boolean;
  openedAt: string | null;
  openedBy: string | null;
  aberturaAutomatica: boolean;
  caixasAbertos: Array<{ code: string; responsavel: string }>;
  vendasHoje: number;
  faturamentoHoje: string | null;
  pessoasTrabalhando: number;
}

interface Summary {
  vendas: number;
  pecas: number;
  faturamento: string | null;
  margem: string | null;
  margemPercentual: string | null;
  ticketMedio: string | null;
}

interface TrendPoint {
  label: string;
  value: number;
}

interface StoreRevenue {
  storeId: string;
  nome: string;
  faturamento: string | null;
}

interface PaymentRow {
  metodo: string;
  total: string | null;
}

interface GoalRow {
  id: string;
  loja: string;
  vendedor: string | null;
  meta: string | null;
  realizado: string | null;
  percentual: string;
  atingida: boolean;
  falta: string | null;
}

interface OverdueSession {
  id: string;
  code: string;
  loja: string;
  caixa: string;
  abertoPor: string;
  diasEmAberto: number;
  vendas: number;
}

interface LowStockRow {
  id: string;
  name: string;
  sku: string;
  storeName: string;
  quantity: number;
  minQuantity: number;
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

const formatTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—";

const last30 = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
};

/**
 * Painel do dono.
 *
 * É a primeira tela de quem abre o sistema para saber como a rede está, não
 * para vender. Responde, sem clique nenhum: quais lojas estão abertas, quanto
 * entrou hoje, quem está trabalhando, o que está acabando e qual caixa não
 * bateu.
 */
export function DashboardPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const range = last30();

  const network = useQuery({
    queryKey: ["network-status"],
    queryFn: () => apiFetch<StoreStatus[]>("/api/v1/stores/network-status"),
    // A loja pode abrir sozinha por um login no tablet — vale reconsultar.
    refetchInterval: 60_000,
  });

  const summary = useQuery({
    queryKey: ["dash-summary", range],
    queryFn: () => apiFetch<Summary>(`/api/v1/reports/sales-summary?${range}`),
  });

  const trend = useQuery({
    queryKey: ["dash-trend"],
    queryFn: () => apiFetch<TrendPoint[]>("/api/v1/reports/sales-trend?days=14"),
  });

  const byStore = useQuery({
    queryKey: ["dash-by-store", range],
    queryFn: () => apiFetch<StoreRevenue[]>(`/api/v1/reports/sales-by-store?${range}`),
  });

  const payments = useQuery({
    queryKey: ["dash-payments", range],
    queryFn: () => apiFetch<PaymentRow[]>(`/api/v1/reports/payments?${range}`),
  });

  const goals = useQuery({
    queryKey: ["dash-goals"],
    queryFn: () => apiFetch<GoalRow[]>("/api/v1/goals?activeOnly=true"),
  });

  /**
   * Caixas que passaram do dia sem fechar. Aparece antes de tudo: enquanto o
   * turno de ontem estiver aberto, o dinheiro de dois dias está na mesma
   * gaveta e a conferência de hoje não significa nada.
   */
  const overdue = useQuery({
    queryKey: ["cash-overdue"],
    queryFn: () => apiFetch<OverdueSession[]>("/api/v1/cash/sessions/overdue"),
    retry: false,
  });

  const lowStock = useQuery({
    queryKey: ["dash-low-stock"],
    queryFn: () => apiFetch<LowStockRow[]>("/api/v1/stock?lowStockOnly=true"),
  });

  const toggleStore = useMutation({
    mutationFn: (params: { id: string; open: boolean }) =>
      apiFetch(`/api/v1/stores/${params.id}/${params.open ? "open" : "close"}`, {
        method: "POST",
        body: {},
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["network-status"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível concluir."),
  });

  const faturamentoHoje = (network.data ?? []).reduce(
    (sum, store) => sum + Number(store.faturamentoHoje ?? 0),
    0,
  );
  const vendasHoje = (network.data ?? []).reduce((sum, store) => sum + store.vendasHoje, 0);
  const trabalhando = (network.data ?? []).reduce(
    (sum, store) => sum + store.pessoasTrabalhando,
    0,
  );
  const abertas = (network.data ?? []).filter((store) => store.isOpen).length;

  return (
    <PageShell
      eyebrow="Visão geral"
      title="Painel"
      description="Como a rede está agora, e como foi o último mês."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {overdue.data && overdue.data.length > 0 && (
        <div className="mb-6">
          <Alert tone="error" title="Caixa aberto desde ontem">
            <p>
              O fechamento é diário. Enquanto estes turnos não fecharem, o dinheiro de mais de um
              dia está na mesma gaveta e a conferência não separa de onde veio a diferença.
            </p>
            <ul className="mt-2 space-y-1">
              {overdue.data.map((session) => (
                <li key={session.id}>
                  <strong>{session.code}</strong> · {session.loja} — {session.caixa} · aberto por{" "}
                  {session.abertoPor} há {session.diasEmAberto} dia(s) · {session.vendas} venda(s)
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Vendido hoje"
          value={formatMoney(String(faturamentoHoje))}
          hint={`${vendasHoje} venda(s) na rede`}
          icon={Gem}
          tone="rose"
        />
        <MetricCard
          label="Faturamento do mês"
          value={formatMoney(summary.data?.faturamento)}
          hint={
            summary.data?.margemPercentual
              ? `margem de ${summary.data.margemPercentual}%`
              : undefined
          }
          icon={TrendingUp}
          tone="graphite"
        />
        <MetricCard
          label="Lojas abertas"
          value={`${abertas} de ${network.data?.length ?? 0}`}
          hint={`${trabalhando} pessoa(s) trabalhando`}
          icon={DoorOpen}
          tone="success"
        />
        <MetricCard
          label="Estoque baixo"
          value={`${lowStock.data?.length ?? 0} itens`}
          hint="abaixo do mínimo definido"
          icon={AlertTriangle}
          tone="warning"
        />
      </section>

      {/* Controle geral: abrir e fechar qualquer loja de onde estiver. */}
      <Card className="mb-6">
        <CardHeader
          title="Lojas"
          description="A loja abre sozinha quando alguém entra pelo tablet dela. Fechar é sempre na mão."
        />
        <CardBody className="space-y-3">
          {network.data?.map((store) => (
            <div
              key={store.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border/70 p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text-primary">{store.name}</span>
                  {store.isOpen ? (
                    <Badge tone="success">
                      <DoorOpen className="h-3 w-3" aria-hidden />
                      Aberta desde {formatTime(store.openedAt)}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">
                      <DoorClosed className="h-3 w-3" aria-hidden />
                      Fechada
                    </Badge>
                  )}
                  {store.caixasAbertos.length > 0 && (
                    <Badge tone="rose">
                      {store.caixasAbertos.length} caixa(s) aberto(s)
                    </Badge>
                  )}
                </div>

                <p className="mt-1 text-sm text-text-secondary">
                  {store.isOpen && store.openedBy
                    ? `${store.aberturaAutomatica ? "Aberta pelo tablet de" : "Aberta por"} ${store.openedBy} · `
                    : ""}
                  {store.vendasHoje} venda(s) hoje ·{" "}
                  {formatMoney(store.faturamentoHoje)} ·{" "}
                  {store.pessoasTrabalhando} no salão
                </p>
              </div>

              <Button
                type="button"
                variant={store.isOpen ? "outline" : "primary"}
                disabled={toggleStore.isPending}
                onClick={() => toggleStore.mutate({ id: store.id, open: !store.isOpen })}
              >
                {store.isOpen ? (
                  <>
                    <DoorClosed className="h-5 w-5" aria-hidden />
                    Fechar loja
                  </>
                ) : (
                  <>
                    <DoorOpen className="h-5 w-5" aria-hidden />
                    Abrir loja
                  </>
                )}
              </Button>
            </div>
          ))}

          {network.data?.length === 0 && (
            <Alert tone="info">Nenhuma loja cadastrada ainda.</Alert>
          )}
        </CardBody>
      </Card>

      <div className="mb-6 grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
        <Card>
          <CardHeader title="Faturamento dos últimos 14 dias" />
          <CardBody>
            <TrendChart data={trend.data ?? []} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Por loja" description="Últimos 30 dias" />
          <CardBody>
            <BarList
              data={(byStore.data ?? []).map((store) => ({
                label: store.nome,
                value: Number(store.faturamento ?? 0),
              }))}
            />
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Como o dinheiro entrou" description="Últimos 30 dias" />
          <CardBody>
            <DonutChart
              data={(payments.data ?? []).map((payment) => ({
                label: PAYMENT_LABELS[payment.metodo] ?? payment.metodo,
                value: Number(payment.total ?? 0),
              }))}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Metas em andamento" />
          <CardBody>
            {goals.data?.length === 0 ? (
              <p className="text-sm text-text-muted">
                Nenhuma meta ativa. Defina uma em Relatórios.
              </p>
            ) : (
              <ul className="space-y-4">
                {goals.data?.map((goal) => (
                  <li key={goal.id}>
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
                        <Target className="h-4 w-4 text-text-muted" aria-hidden />
                        {goal.vendedor ?? goal.loja}
                      </span>
                      <span className="text-sm text-text-secondary">
                        {formatMoney(goal.realizado)} de {formatMoney(goal.meta)}
                      </span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-background-secondary"
                      role="progressbar"
                      aria-valuenow={Math.min(100, Number(goal.percentual))}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Meta de ${goal.vendedor ?? goal.loja}`}
                    >
                      <div
                        className={`h-full rounded-full ${goal.atingida ? "bg-success" : "bg-rose-primary"}`}
                        style={{ width: `${Math.min(100, Number(goal.percentual))}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {goal.atingida
                        ? "Meta batida."
                        : `Faltam ${formatMoney(goal.falta)} · ${goal.percentual}%`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Precisa repor"
            description="Peças abaixo do mínimo definido para a loja"
          />
          <CardBody>
            {lowStock.data?.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <Boxes className="h-4 w-4" aria-hidden />
                Nenhuma peça abaixo do mínimo.
              </p>
            ) : (
              <ul className="divide-y divide-border/70">
                {lowStock.data?.slice(0, 10).map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">{row.name}</p>
                      <p className="text-sm text-text-secondary">
                        {row.sku} · {row.storeName}
                      </p>
                    </div>
                    <Badge tone="warning">
                      {row.quantity} de {row.minQuantity}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <p className="mt-6 flex items-center gap-2 text-sm text-text-muted">
        <Users className="h-4 w-4" aria-hidden />
        Os números vêm das vendas concluídas — nada aqui é saldo acumulado.
      </p>
    </PageShell>
  );
}
