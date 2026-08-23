import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { StorePicker } from "@/features/stores/store-picker";

type Status =
  | "ABERTA"
  | "EM_ANALISE"
  | "AGUARDANDO_CLIENTE"
  | "EM_REPARO"
  | "PRONTA"
  | "ENTREGUE"
  | "CANCELADA";

interface ServiceOrder {
  id: string;
  code: string;
  status: Status;
  description: string;
  intakeCondition: string;
  estimatedAmount: string | null;
  finalAmount: string | null;
  underWarranty: boolean;
  promisedFor: string | null;
  deliveredAt: string | null;
  notes: string | null;
  createdAt: string;
  atrasada: boolean;
  diasNaLoja: number;
  customer: { id: string; name: string; phone: string };
  store: { name: string };
}

interface CustomerRow {
  id: string;
  name: string;
  phone: string;
}

const STATUS_LABELS: Record<Status, string> = {
  ABERTA: "Aberta",
  EM_ANALISE: "Em análise",
  AGUARDANDO_CLIENTE: "Aguardando cliente",
  EM_REPARO: "Em reparo",
  PRONTA: "Pronta",
  ENTREGUE: "Entregue",
  CANCELADA: "Cancelada",
};

/** Cor por situação — a fila da oficina se lê sem abrir cada ordem. */
const STATUS_TONE: Record<Status, string> = {
  ABERTA: "bg-ocean-soft text-ocean-dark",
  EM_ANALISE: "bg-ocean-soft text-ocean-dark",
  AGUARDANDO_CLIENTE: "bg-gold-soft text-gold-dark",
  EM_REPARO: "bg-clay-soft text-clay-dark",
  PRONTA: "bg-sage-soft text-sage-dark",
  ENTREGUE: "bg-background-secondary text-text-muted",
  CANCELADA: "bg-background-secondary text-text-muted",
};

/**
 * O próximo passo de cada situação.
 *
 * A tela oferece um botão só, com o nome do que vai acontecer, em vez de uma
 * lista com sete opções — quem está no balcão com a peça na mão quer avançar a
 * ordem, não estudar a máquina de estados.
 */
const PROXIMO: Partial<Record<Status, { para: Status; rotulo: string }>> = {
  ABERTA: { para: "EM_ANALISE", rotulo: "Iniciar análise" },
  EM_ANALISE: { para: "EM_REPARO", rotulo: "Começar o reparo" },
  AGUARDANDO_CLIENTE: { para: "EM_REPARO", rotulo: "Cliente aprovou" },
  EM_REPARO: { para: "PRONTA", rotulo: "Marcar como pronta" },
  PRONTA: { para: "ENTREGUE", rotulo: "Entregar ao cliente" },
};

const formatMoney = (valor: string | null) =>
  valor === null
    ? "—"
    : Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDate = (iso: string | null) =>
  iso === null ? "—" : new Date(iso).toLocaleDateString("pt-BR");

export function ServiceOrdersPage() {
  const queryClient = useQueryClient();

  const [storeId, setStoreId] = useState("");
  const [abrindo, setAbrindo] = useState(false);
  const [soAbertas, setSoAbertas] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Ordem em entrega, esperando o valor cobrado. */
  const [entregando, setEntregando] = useState<ServiceOrder | null>(null);
  const [valorFinal, setValorFinal] = useState("");

  const [form, setForm] = useState({
    customerId: "",
    description: "",
    intakeCondition: "",
    estimatedAmount: "",
    promisedFor: "",
    underWarranty: false,
  });

  const orders = useQuery({
    queryKey: ["service-orders", storeId, soAbertas],
    queryFn: () => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (soAbertas) params.set("emAberto", "true");
      return apiFetch<ServiceOrder[]>(`/api/v1/service-orders?${params.toString()}`);
    },
  });

  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => apiFetch<CustomerRow[]>("/api/v1/customers"),
    enabled: abrindo,
  });

  const limpar = () => {
    setAbrindo(false);
    setForm({
      customerId: "",
      description: "",
      intakeCondition: "",
      estimatedAmount: "",
      promisedFor: "",
      underWarranty: false,
    });
  };

  const abrir = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/service-orders", {
        method: "POST",
        body: {
          storeId,
          customerId: form.customerId,
          description: form.description.trim(),
          intakeCondition: form.intakeCondition.trim(),
          underWarranty: form.underWarranty,
          ...(form.estimatedAmount ? { estimatedAmount: Number(form.estimatedAmount) } : {}),
          ...(form.promisedFor
            ? { promisedFor: new Date(`${form.promisedFor}T18:00:00`).toISOString() }
            : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      limpar();
      void queryClient.invalidateQueries({ queryKey: ["service-orders"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível abrir a ordem."),
  });

  const avancar = useMutation({
    mutationFn: (params: { id: string; status: Status; finalAmount?: number }) =>
      apiFetch(`/api/v1/service-orders/${params.id}`, {
        method: "PATCH",
        body: {
          status: params.status,
          ...(params.finalAmount !== undefined ? { finalAmount: params.finalAmount } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setEntregando(null);
      setValorFinal("");
      void queryClient.invalidateQueries({ queryKey: ["service-orders"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível atualizar."),
  });

  const cancelar = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      apiFetch(`/api/v1/service-orders/${params.id}/cancel`, {
        method: "POST",
        body: { reason: params.reason },
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["service-orders"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível cancelar."),
  });

  const atrasadas = orders.data?.filter((order) => order.atrasada).length ?? 0;

  return (
    <PageShell
      eyebrow="Pós-venda"
      title="Ordens de serviço"
      description="A peça que ficou na loja para conserto: de quem é, como chegou e quando fica pronta."
      actions={
        !abrindo && (
          <Button type="button" onClick={() => setAbrindo(true)} disabled={!storeId}>
            <Plus className="h-5 w-5" aria-hidden />
            Nova ordem
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {atrasadas > 0 && (
        <div className="mb-5">
          <Alert tone="info" title={`${atrasadas} ordem(ns) passaram do prazo prometido`}>
            A peça está na loja há mais tempo do que foi combinado. Ligue para o cliente antes que
            ele ligue.
          </Alert>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-end gap-4">
        <StorePicker storeId={storeId} onChange={setStoreId} className="min-w-[12rem]" />

        <label className="flex min-h-[48px] items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            className="h-5 w-5 accent-rose-primary"
            checked={soAbertas}
            onChange={(event) => setSoAbertas(event.target.checked)}
          />
          Só as que ainda estão na loja
        </label>
      </div>

      {abrindo && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-soft"
          onSubmit={(event) => {
            event.preventDefault();
            abrir.mutate();
          }}
        >
          <h2 className="mb-4 font-medium text-text-primary">Nova ordem de serviço</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="cliente"
                className="mb-1 block text-sm font-medium text-text-primary"
              >
                Cliente
              </label>
              <select
                id="cliente"
                required
                value={form.customerId}
                onChange={(event) => setForm({ ...form, customerId: event.target.value })}
                className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
              >
                <option value="">Selecione</option>
                {customers.data?.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} · {customer.phone}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Prazo prometido"
              type="date"
              value={form.promisedFor}
              onChange={(event) => setForm({ ...form, promisedFor: event.target.value })}
              hint="O que você disse ao cliente. É contra isso que a ordem aparece atrasada."
            />

            <div className="sm:col-span-2">
              <Field
                label="O que a peça precisa"
                required
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Soldar a aliança, trocar o fecho da corrente..."
              />
            </div>

            <div className="sm:col-span-2">
              <Field
                label="Como a peça chegou"
                required
                value={form.intakeCondition}
                onChange={(event) => setForm({ ...form, intakeCondition: event.target.value })}
                placeholder="Riscada na parte de baixo, sem a pedra do lado direito..."
                hint="Descreva o estado agora. É o que protege a loja se o cliente apontar um dano na retirada."
              />
            </div>

            <Field
              label="Orçamento (R$)"
              type="number"
              step="0.01"
              min={0}
              value={form.estimatedAmount}
              onChange={(event) => setForm({ ...form, estimatedAmount: event.target.value })}
            />

            <label className="flex min-h-[48px] items-center gap-2 self-end text-sm text-text-secondary">
              <input
                type="checkbox"
                className="h-5 w-5 accent-rose-primary"
                checked={form.underWarranty}
                onChange={(event) => setForm({ ...form, underWarranty: event.target.checked })}
              />
              Coberta pela garantia (não se cobra)
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" disabled={abrir.isPending}>
              {abrir.isPending ? "Abrindo..." : "Abrir ordem"}
            </Button>
            <Button type="button" variant="outline" onClick={limpar}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {orders.data?.length === 0 && (
        <Alert tone="info">
          <span className="flex items-center gap-2">
            <Wrench className="h-4 w-4" aria-hidden />
            Nenhuma peça em conserto {soAbertas ? "no momento" : "no período"}.
          </span>
        </Alert>
      )}

      <ul className="space-y-3">
        {orders.data?.map((order) => {
          const proximo = PROXIMO[order.status];

          return (
            <li
              key={order.id}
              className={`rounded-lg border bg-surface p-5 ${
                order.atrasada ? "border-warning" : "border-border"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-text-muted">{order.code}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${STATUS_TONE[order.status]}`}
                    >
                      {STATUS_LABELS[order.status]}
                    </span>
                    {order.underWarranty && (
                      <span className="rounded-full bg-sage-soft px-2.5 py-0.5 text-sm text-sage-dark">
                        Garantia
                      </span>
                    )}
                    {order.atrasada && (
                      <span className="flex items-center gap-1 text-sm text-warning">
                        <AlertTriangle className="h-4 w-4" aria-hidden />
                        Passou do prazo
                      </span>
                    )}
                  </div>

                  <p className="mt-1.5 font-medium text-text-primary">{order.description}</p>
                  <p className="text-sm text-text-secondary">
                    {order.customer.name} · {order.customer.phone}
                  </p>
                  <p className="mt-1 text-sm text-text-muted">
                    Chegou assim: {order.intakeCondition}
                  </p>
                  <p className="mt-1 text-sm text-text-muted">
                    {order.diasNaLoja} dia(s) na loja · prometida para {formatDate(order.promisedFor)}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm text-text-muted">
                    {order.finalAmount ? "cobrado" : "orçamento"}
                  </p>
                  <p className="font-medium text-text-primary">
                    {formatMoney(order.finalAmount ?? order.estimatedAmount)}
                  </p>
                </div>
              </div>

              {entregando?.id === order.id ? (
                <form
                  className="mt-4 flex flex-wrap items-end gap-3 rounded-md bg-background-secondary p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    avancar.mutate({
                      id: order.id,
                      status: "ENTREGUE",
                      ...(order.underWarranty && !valorFinal
                        ? {}
                        : { finalAmount: Number(valorFinal) }),
                    });
                  }}
                >
                  <div className="min-w-[10rem]">
                    <Field
                      label="Quanto foi cobrado (R$)"
                      type="number"
                      step="0.01"
                      min={0}
                      autoFocus
                      required={!order.underWarranty}
                      value={valorFinal}
                      onChange={(event) => setValorFinal(event.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={avancar.isPending}>
                    Confirmar entrega
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setEntregando(null)}>
                    Voltar
                  </Button>
                </form>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {proximo && (
                    <Button
                      type="button"
                      disabled={avancar.isPending}
                      onClick={() => {
                        if (proximo.para === "ENTREGUE") {
                          setEntregando(order);
                          setValorFinal(order.finalAmount ?? order.estimatedAmount ?? "");
                          return;
                        }
                        avancar.mutate({ id: order.id, status: proximo.para });
                      }}
                    >
                      {proximo.rotulo}
                    </Button>
                  )}

                  {order.status === "EM_ANALISE" && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        avancar.mutate({ id: order.id, status: "AGUARDANDO_CLIENTE" })
                      }
                    >
                      Aguardar aprovação
                    </Button>
                  )}

                  {order.status !== "ENTREGUE" && order.status !== "CANCELADA" && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        const reason = window.prompt(
                          `Cancelar a ordem ${order.code}. Por quê?`,
                        );
                        if (reason && reason.trim().length >= 3) {
                          cancelar.mutate({ id: order.id, reason: reason.trim() });
                        }
                      }}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </PageShell>
  );
}
