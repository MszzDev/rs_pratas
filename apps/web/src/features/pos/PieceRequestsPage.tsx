import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, HandHeart, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { StorePicker } from "@/features/stores/store-picker";

type Status = "ABERTA" | "PROCURANDO" | "ENCONTRADA" | "AVISADO" | "CONCLUIDA" | "CANCELADA";

interface PieceRequest {
  id: string;
  code: string;
  status: Status;
  customerName: string;
  customerPhone: string;
  description: string;
  size: string | null;
  budgetAmount: string | null;
  notes: string | null;
  notifiedAt: string | null;
  diasEsperando: number;
  createdAt: string;
  store: { name: string };
  createdBy: { name: string };
}


interface DemandRow {
  termo: string;
  pedidos: number;
  atendidos: number;
}

const STATUS_LABELS: Record<Status, string> = {
  ABERTA: "Anotada",
  PROCURANDO: "Procurando",
  ENCONTRADA: "Achamos",
  AVISADO: "Cliente avisado",
  CONCLUIDA: "Levou a peça",
  CANCELADA: "Cancelada",
};

const STATUS_TONES: Record<Status, "neutral" | "info" | "warning" | "success" | "rose"> = {
  ABERTA: "warning",
  PROCURANDO: "info",
  ENCONTRADA: "rose",
  AVISADO: "rose",
  CONCLUIDA: "success",
  CANCELADA: "neutral",
};

/** O próximo passo natural de cada situação — só um botão, sem menu. */
const PROXIMO: Partial<Record<Status, { status: Status; rotulo: string }>> = {
  ABERTA: { status: "PROCURANDO", rotulo: "Estou procurando" },
  PROCURANDO: { status: "ENCONTRADA", rotulo: "Achei a peça" },
  ENCONTRADA: { status: "AVISADO", rotulo: "Avisei o cliente" },
  AVISADO: { status: "CONCLUIDA", rotulo: "Cliente levou" },
};

const formatPhone = (digits: string) =>
  digits.length === 11
    ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
    : digits.length === 10
      ? `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
      : digits;

/**
 * Solicitar peça.
 *
 * É o pedido que hoje vira bilhete no caderno e some: o cliente entra
 * procurando algo que a loja não tem, o vendedor promete avisar, e ninguém
 * avisa. Anotado aqui, o cliente é chamado quando a peça chega — e a loja
 * passa a ter a lista do que procuram e ela não tem, que é o que decide a
 * próxima compra do fornecedor.
 */
export function PieceRequestsPage() {
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState("");
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [criando, setCriando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    description: "",
    size: "",
    budgetAmount: "",
    notes: "",
  });


  const pedidos = useQuery({
    queryKey: ["piece-requests", storeId, mostrarTodos],
    queryFn: () => {
      const params = new URLSearchParams();
      if (storeId) params.set("storeId", storeId);
      if (!mostrarTodos) params.set("emAberto", "true");
      return apiFetch<PieceRequest[]>(`/api/v1/piece-requests?${params.toString()}`);
    },
  });

  const demanda = useQuery({
    queryKey: ["piece-demand", storeId],
    queryFn: () =>
      apiFetch<DemandRow[]>(
        `/api/v1/piece-requests/demand${storeId ? `?storeId=${storeId}` : ""}`,
      ),
    retry: false,
  });

  const handleError = (caught: unknown) =>
    setError(caught instanceof ApiError ? caught.message : "Não foi possível concluir.");

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ["piece-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["piece-demand"] });
  };

  const criar = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/piece-requests", {
        method: "POST",
        body: {
          storeId,
          customerName: form.customerName.trim(),
          customerPhone: form.customerPhone,
          description: form.description.trim(),
          ...(form.size ? { size: form.size } : {}),
          ...(form.budgetAmount ? { budgetAmount: Number(form.budgetAmount) } : {}),
          ...(form.notes ? { notes: form.notes } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setCriando(false);
      setForm({
        customerName: "",
        customerPhone: "",
        description: "",
        size: "",
        budgetAmount: "",
        notes: "",
      });
      invalidar();
    },
    onError: handleError,
  });

  const avancar = useMutation({
    mutationFn: (params: { id: string; status: Status }) =>
      apiFetch(`/api/v1/piece-requests/${params.id}`, {
        method: "PATCH",
        body: { status: params.status },
      }),
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: handleError,
  });

  const cancelar = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      apiFetch(`/api/v1/piece-requests/${params.id}/cancel`, {
        method: "POST",
        body: { reason: params.reason },
      }),
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: handleError,
  });

  return (
    <PageShell
      eyebrow="Atendimento"
      title="Solicitar peça"
      description="O cliente pediu algo que a loja não tem. Anote aqui para não se perder num papel."
      actions={
        criando ? null : (
          <Button type="button" onClick={() => setCriando(true)}>
            <Plus className="h-5 w-5" aria-hidden />
            Anotar pedido
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-end gap-4">
      <StorePicker storeId={storeId} onChange={setStoreId} todas className="min-w-[12rem]" />

        <label className="flex min-h-[48px] items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            className="h-5 w-5 accent-rose-primary"
            checked={mostrarTodos}
            onChange={(event) => setMostrarTodos(event.target.checked)}
          />
          Mostrar também os encerrados
        </label>
      </div>

      {criando && (
        <Card className="mb-6">
          <CardHeader
            title="O que o cliente está procurando"
            description="Escreva com as palavras dele. Não precisa ser uma peça do catálogo — o pedido existe justamente porque a loja não tem."
          />
          <CardBody>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                criar.mutate();
              }}
            >
              {!storeId && (
                <div className="mb-4">
                  <Alert tone="info">Escolha a loja acima antes de anotar.</Alert>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Nome do cliente"
                  required
                  value={form.customerName}
                  onChange={(event) => setForm({ ...form, customerName: event.target.value })}
                />
                <Field
                  label="Telefone"
                  required
                  inputMode="tel"
                  value={form.customerPhone}
                  onChange={(event) => setForm({ ...form, customerPhone: event.target.value })}
                  hint="Com DDD. É por ele que vamos avisar quando a peça chegar."
                />

                <div className="sm:col-span-2">
                  <Field
                    label="O que ele quer"
                    required
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                    hint="Ex.: anel de coração com pedra azul, aro 18."
                  />
                </div>

                <Field
                  label="Tamanho"
                  value={form.size}
                  onChange={(event) => setForm({ ...form, size: event.target.value })}
                  hint="Se for anel ou pulseira."
                />
                <Field
                  label="Quanto ele topa pagar (R$)"
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.budgetAmount}
                  onChange={(event) => setForm({ ...form, budgetAmount: event.target.value })}
                  hint="Ajuda a decidir se vale encomendar."
                />

                <div className="sm:col-span-2">
                  <Field
                    label="Observações"
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                    hint="Ex.: é presente de aniversário dia 20."
                  />
                </div>
              </div>

              <div className="mt-5 flex gap-3">
                <Button type="submit" disabled={!storeId || criar.isPending}>
                  Anotar pedido
                </Button>
                <Button type="button" variant="outline" onClick={() => setCriando(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <ul className="mb-8 space-y-3">
        {pedidos.data?.map((pedido) => {
          const proximo = PROXIMO[pedido.status];

          return (
            <li
              key={pedido.id}
              className="rounded-lg border border-border/70 bg-surface p-5 shadow-soft"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-primary">{pedido.customerName}</span>
                    <Badge tone={STATUS_TONES[pedido.status]}>
                      {STATUS_LABELS[pedido.status]}
                    </Badge>
                    {/* Pedido de três semanas sem resposta é cliente perdido. */}
                    {pedido.diasEsperando >= 7 &&
                      pedido.status !== "CONCLUIDA" &&
                      pedido.status !== "CANCELADA" && (
                        <Badge tone="danger">
                          esperando há {pedido.diasEsperando} dias
                        </Badge>
                      )}
                  </div>

                  <p className="mt-1 text-text-primary">{pedido.description}</p>

                  <p className="mt-1 text-sm text-text-secondary">
                    {formatPhone(pedido.customerPhone)}
                    {pedido.size ? ` · tamanho ${pedido.size}` : ""}
                    {pedido.budgetAmount ? ` · até ${formatMoney(pedido.budgetAmount)}` : ""}
                    {` · ${pedido.code} · ${pedido.store.name}`}
                  </p>

                  {pedido.notes && (
                    <p className="mt-1 text-sm text-text-muted">“{pedido.notes}”</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {proximo && (
                    <Button
                      type="button"
                      variant={pedido.status === "AVISADO" ? "primary" : "outline"}
                      disabled={avancar.isPending}
                      onClick={() => avancar.mutate({ id: pedido.id, status: proximo.status })}
                    >
                      {pedido.status === "ENCONTRADA" ? (
                        <Bell className="h-5 w-5" aria-hidden />
                      ) : (
                        <Check className="h-5 w-5" aria-hidden />
                      )}
                      {proximo.rotulo}
                    </Button>
                  )}

                  {pedido.status !== "CONCLUIDA" && pedido.status !== "CANCELADA" && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={cancelar.isPending}
                      onClick={() => {
                        const reason = window.prompt(
                          `Cancelar o pedido de ${pedido.customerName}. Por quê?`,
                        );
                        if (reason && reason.trim().length >= 3) {
                          cancelar.mutate({ id: pedido.id, reason: reason.trim() });
                        }
                      }}
                    >
                      <X className="h-5 w-5" aria-hidden />
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {pedidos.data?.length === 0 && (
        <Alert tone="info">
          <span className="flex items-center gap-2">
            <Search className="h-4 w-4" aria-hidden />
            Nenhum pedido {mostrarTodos ? "registrado" : "em aberto"}.
          </span>
        </Alert>
      )}

      {/*
        A lista do que procuram e a loja não tem. É a informação que nenhum
        sistema costuma guardar, porque a venda que não aconteceu não deixa
        rastro — e é justamente ela que decide a próxima compra.
      */}
      {demanda.data && demanda.data.length > 0 && (
        <Card>
          <CardHeader
            title="O que estão procurando e não temos"
            description="Termos que apareceram em mais de um pedido nos últimos 90 dias."
          />
          <CardBody>
            <ul className="flex flex-wrap gap-2">
              {demanda.data.map((linha) => (
                <li
                  key={linha.termo}
                  className="flex items-center gap-2 rounded-full border border-border/70 px-3 py-1.5 text-sm"
                >
                  <HandHeart className="h-4 w-4 text-rose-primary" aria-hidden />
                  <span className="text-text-primary">{linha.termo}</span>
                  <span className="text-text-muted">
                    {linha.pedidos} pedido(s) · {linha.atendidos} atendido(s)
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </PageShell>
  );
}
