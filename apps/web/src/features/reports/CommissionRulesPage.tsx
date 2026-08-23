import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, Plus, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { StorePicker } from "@/features/stores/store-picker";

interface CommissionRule {
  id: string;
  name: string;
  percent: string;
  basis: "FATURAMENTO" | "MARGEM";
  storeId: string | null;
  userId: string | null;
  minimumSalesAmount: string | null;
  isActive: boolean;
}

/**
 * O endpoint de metas já devolve o progresso calculado e com os nomes
 * resolvidos — em português, como o resto do relatório. A tela consome o que
 * ele manda em vez de recalcular ou traduzir de novo.
 */
interface Goal {
  id: string;
  loja: string;
  escopo: "LOJA" | "VENDEDOR";
  vendedor: string | null;
  periodo: "DIARIA" | "SEMANAL" | "MENSAL";
  inicio: string;
  fim: string;
  meta: string;
  realizado: string;
  percentual: string;
  atingida: boolean;
  falta: string;
}

interface UserRow {
  id: string;
  name: string;
  employeeCode: string;
  role: string;
}

const formatMoney = (valor: string | number | null | undefined) =>
  valor === null || valor === undefined
    ? "—"
    : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

/** Primeiro e último dia do mês corrente, em ISO — o padrão de uma meta. */
function mesCorrente() {
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);
  return { inicio, fim };
}

export function CommissionRulesPage() {
  const queryClient = useQueryClient();

  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [criandoRegra, setCriandoRegra] = useState(false);
  const [criandoMeta, setCriandoMeta] = useState(false);

  const [regra, setRegra] = useState({
    name: "",
    percent: "",
    basis: "FATURAMENTO" as "FATURAMENTO" | "MARGEM",
    userId: "",
    minimumSalesAmount: "",
  });

  const [meta, setMeta] = useState({
    scope: "LOJA" as "LOJA" | "VENDEDOR",
    userId: "",
    period: "MENSAL" as "DIARIA" | "SEMANAL" | "MENSAL",
    targetAmount: "",
  });

  const rules = useQuery({
    queryKey: ["commission-rules"],
    queryFn: () => apiFetch<CommissionRule[]>("/api/v1/commission-rules"),
  });

  const goals = useQuery({
    queryKey: ["goals", storeId],
    queryFn: () =>
      apiFetch<Goal[]>(`/api/v1/goals${storeId ? `?storeId=${storeId}` : ""}`),
  });

  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserRow[]>("/api/v1/users"),
  });

  const nomeDe = (id: string | null) =>
    id === null ? null : users.data?.find((u) => u.id === id)?.name ?? "—";

  const criarRegra = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/commission-rules", {
        method: "POST",
        body: {
          name: regra.name.trim(),
          percent: Number(regra.percent),
          basis: regra.basis,
          ...(storeId ? { storeId } : {}),
          ...(regra.userId ? { userId: regra.userId } : {}),
          ...(regra.minimumSalesAmount
            ? { minimumSalesAmount: Number(regra.minimumSalesAmount) }
            : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setCriandoRegra(false);
      setRegra({ name: "", percent: "", basis: "FATURAMENTO", userId: "", minimumSalesAmount: "" });
      void queryClient.invalidateQueries({ queryKey: ["commission-rules"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível criar a regra."),
  });

  const criarMeta = useMutation({
    mutationFn: () => {
      const { inicio, fim } = mesCorrente();

      return apiFetch("/api/v1/goals", {
        method: "POST",
        body: {
          storeId,
          scope: meta.scope,
          period: meta.period,
          periodStart: inicio.toISOString(),
          periodEnd: fim.toISOString(),
          targetAmount: Number(meta.targetAmount),
          ...(meta.scope === "VENDEDOR" && meta.userId ? { userId: meta.userId } : {}),
        },
      });
    },
    onSuccess: () => {
      setError(null);
      setCriandoMeta(false);
      setMeta({ scope: "LOJA", userId: "", period: "MENSAL", targetAmount: "" });
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível criar a meta."),
  });

  const remover = useMutation({
    mutationFn: (params: { tipo: "commission-rules" | "goals"; id: string; reason: string }) =>
      apiFetch(`/api/v1/${params.tipo}/${params.id}`, {
        method: "DELETE",
        body: { reason: params.reason },
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["commission-rules"] });
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível remover."),
  });

  const pedirMotivoERemover = (
    tipo: "commission-rules" | "goals",
    id: string,
    pergunta: string,
  ) => {
    const reason = window.prompt(pergunta);
    if (reason && reason.trim().length >= 3) {
      remover.mutate({ tipo, id, reason: reason.trim() });
    }
  };

  return (
    <PageShell
      eyebrow="Gestão"
      title="Comissões e metas"
      description="Quanto se paga sobre a venda e quanto se espera vender. Só o dono define."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <StorePicker storeId={storeId} onChange={setStoreId} todas />

      {/* ------------------------------------------------------- comissões */}
      <section className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-md bg-sage-soft text-sage"
              aria-hidden
            >
              <Percent className="h-[18px] w-[18px]" />
            </span>
            Regras de comissão
          </h2>

          {!criandoRegra && (
            <Button type="button" variant="outline" onClick={() => setCriandoRegra(true)}>
              <Plus className="h-5 w-5" aria-hidden />
              Nova regra
            </Button>
          )}
        </div>

        {criandoRegra && (
          <form
            className="mb-4 rounded-lg border border-border bg-surface p-5 shadow-soft"
            onSubmit={(event) => {
              event.preventDefault();
              criarRegra.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Nome da regra"
                required
                autoFocus
                value={regra.name}
                onChange={(event) => setRegra({ ...regra, name: event.target.value })}
                placeholder="Comissão padrão de vendedor"
              />

              <Field
                label="Percentual (%)"
                type="number"
                step="0.1"
                min={0}
                max={100}
                required
                value={regra.percent}
                onChange={(event) => setRegra({ ...regra, percent: event.target.value })}
              />

              <div>
                <label htmlFor="base" className="mb-1 block text-sm font-medium text-text-primary">
                  Calculada sobre
                </label>
                <select
                  id="base"
                  value={regra.basis}
                  onChange={(event) =>
                    setRegra({ ...regra, basis: event.target.value as "FATURAMENTO" | "MARGEM" })
                  }
                  className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
                >
                  <option value="FATURAMENTO">Faturamento (valor vendido)</option>
                  <option value="MARGEM">Margem (venda menos custo)</option>
                </select>
                <p className="mt-1 text-sm text-text-muted">
                  Sobre a margem, um desconto grande reduz a comissão junto — é o que alinha o
                  vendedor com o lucro da loja.
                </p>
              </div>

              <div>
                <label
                  htmlFor="vendedor-regra"
                  className="mb-1 block text-sm font-medium text-text-primary"
                >
                  Só para um vendedor
                </label>
                <select
                  id="vendedor-regra"
                  value={regra.userId}
                  onChange={(event) => setRegra({ ...regra, userId: event.target.value })}
                  className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
                >
                  <option value="">Todos da loja</option>
                  {users.data?.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.employeeCode})
                    </option>
                  ))}
                </select>
              </div>

              <Field
                label="Só acima de (R$)"
                type="number"
                step="0.01"
                min={0}
                value={regra.minimumSalesAmount}
                onChange={(event) =>
                  setRegra({ ...regra, minimumSalesAmount: event.target.value })
                }
                hint="Abaixo desse total no período, não há comissão. Deixe vazio para pagar desde a primeira venda."
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" disabled={criarRegra.isPending}>
                {criarRegra.isPending ? "Salvando..." : "Criar regra"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setCriandoRegra(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {rules.data?.length === 0 && (
          <Alert tone="info">
            Nenhuma regra cadastrada — hoje ninguém recebe comissão pelo sistema.
          </Alert>
        )}

        <ul className="space-y-2">
          {rules.data?.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4"
            >
              <div className="min-w-0">
                <p className="font-medium text-text-primary">{rule.name}</p>
                <p className="text-sm text-text-secondary">
                  {Number(rule.percent)}% sobre{" "}
                  {rule.basis === "MARGEM" ? "a margem" : "o faturamento"}
                  {rule.userId ? ` · só para ${nomeDe(rule.userId)}` : " · todos os vendedores"}
                  {/* Zero é o mesmo que não ter piso — dizer "a partir de R$ 0,00"
                      é ruído que o dono precisa interpretar toda vez. */}
                  {Number(rule.minimumSalesAmount ?? 0) > 0
                    ? ` · a partir de ${formatMoney(rule.minimumSalesAmount)}`
                    : ""}
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  pedirMotivoERemover(
                    "commission-rules",
                    rule.id,
                    `Remover a regra "${rule.name}". Por quê?`,
                  )
                }
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Remover
              </Button>
            </li>
          ))}
        </ul>
      </section>

      {/* ----------------------------------------------------------- metas */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-md bg-gold-soft text-gold-dark"
              aria-hidden
            >
              <Target className="h-[18px] w-[18px]" />
            </span>
            Metas do mês
          </h2>

          {!criandoMeta && (
            <Button
              type="button"
              variant="outline"
              disabled={!storeId}
              onClick={() => setCriandoMeta(true)}
            >
              <Plus className="h-5 w-5" aria-hidden />
              Nova meta
            </Button>
          )}
        </div>

        {!storeId && (
          <p className="mb-3 text-sm text-text-muted">
            Escolha uma loja acima para criar uma meta — meta é sempre de alguma loja.
          </p>
        )}

        {criandoMeta && (
          <form
            className="mb-4 rounded-lg border border-border bg-surface p-5 shadow-soft"
            onSubmit={(event) => {
              event.preventDefault();
              criarMeta.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="alcance"
                  className="mb-1 block text-sm font-medium text-text-primary"
                >
                  Meta de
                </label>
                <select
                  id="alcance"
                  value={meta.scope}
                  onChange={(event) =>
                    setMeta({ ...meta, scope: event.target.value as "LOJA" | "VENDEDOR" })
                  }
                  className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
                >
                  <option value="LOJA">A loja inteira</option>
                  <option value="VENDEDOR">Um vendedor</option>
                </select>
              </div>

              {meta.scope === "VENDEDOR" && (
                <div>
                  <label
                    htmlFor="vendedor-meta"
                    className="mb-1 block text-sm font-medium text-text-primary"
                  >
                    Vendedor
                  </label>
                  <select
                    id="vendedor-meta"
                    required
                    value={meta.userId}
                    onChange={(event) => setMeta({ ...meta, userId: event.target.value })}
                    className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
                  >
                    <option value="">Selecione</option>
                    {users.data?.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <Field
                label="Quanto vender (R$)"
                type="number"
                step="0.01"
                min={1}
                required
                value={meta.targetAmount}
                onChange={(event) => setMeta({ ...meta, targetAmount: event.target.value })}
                hint="Vale para o mês corrente."
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" disabled={criarMeta.isPending}>
                {criarMeta.isPending ? "Salvando..." : "Criar meta"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setCriandoMeta(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {goals.data?.length === 0 && <Alert tone="info">Nenhuma meta definida no período.</Alert>}

        <ul className="space-y-2">
          {goals.data?.map((goal) => {
            const percentual = Math.min(100, Math.round(Number(goal.percentual)));

            return (
              <li key={goal.id} className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-text-primary">
                      {goal.escopo === "LOJA" ? goal.loja : goal.vendedor} ·{" "}
                      {formatMoney(goal.meta)}
                    </p>
                    <p className="text-sm text-text-secondary">
                      {formatDate(goal.inicio)} a {formatDate(goal.fim)} · vendido{" "}
                      {formatMoney(goal.realizado)}
                      {!goal.atingida && ` · faltam ${formatMoney(goal.falta)}`}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      pedirMotivoERemover("goals", goal.id, "Remover esta meta. Por quê?")
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>

                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-background-secondary">
                  <div
                    className={`h-full rounded-full ${
                      goal.atingida ? "bg-sage" : "bg-gradient-to-r from-gold to-rose-primary"
                    }`}
                    style={{ width: `${percentual}%` }}
                  />
                </div>
                <p className="mt-1 text-sm text-text-muted">{percentual}% da meta</p>
              </li>
            );
          })}
        </ul>
      </section>
    </PageShell>
  );
}
