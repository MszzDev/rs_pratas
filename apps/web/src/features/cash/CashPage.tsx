import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { StorePicker } from "@/features/stores/store-picker";

interface Session {
  id: string;
  code: string;
  status: "ABERTO" | "FECHADO";
  openedAt: string;
  closedAt: string | null;
  countedAmount: string | null;
  expectedAmount: string | null;
  differenceAmount: string | null;
  differenceReason: string | null;
  store: { name: string };
  cashRegister: { name: string };
  openedBy: { name: string };
  closedBy: { name: string } | null;
  _count: { sales: number };
  /**
   * A gaveta passou do limite combinado.
   *
   * Vem só "passou ou não" e o limite — nunca o saldo. A contagem do
   * fechamento é às cegas de propósito, e mandar o valor para a tela
   * desfaria isso.
   */
  sangriaSugerida: { passou: boolean; limite: number } | null;
}


interface StationRow {
  id: string;
  name: string;
  cashRegisters: Array<{ id: string; name: string }>;
}

interface ClosingInfo {
  id: string;
  code: string;
  openedAt: string;
  openedByName: string;
  salesCount: number;
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function CashPage() {
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [opening, setOpening] = useState(false);
  const [registerId, setRegisterId] = useState("");
  const [openingAmount, setOpeningAmount] = useState("");

  const [movingSession, setMovingSession] = useState<{ id: string; kind: "sangria" | "suprimento" } | null>(null);
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");

  const [closingSession, setClosingSession] = useState<ClosingInfo | null>(null);
  const [countedAmount, setCountedAmount] = useState("");
  const [differenceReason, setDifferenceReason] = useState("");
  const [closeResult, setCloseResult] = useState<{
    code: string;
    countedAmount: string;
    expectedAmount: string;
    differenceAmount: string;
    conferido: boolean;
  } | null>(null);


  /**
   * Os caixas vêm por loja: a rota de estações já devolve os caixas de cada
   * uma. Sem loja escolhida não há o que listar — abrir caixa exige saber
   * qual gaveta.
   */
  const stations = useQuery({
    queryKey: ["pos-stations", storeId],
    queryFn: () => apiFetch<StationRow[]>(`/api/v1/pos-stations?storeId=${storeId}`),
    enabled: storeId !== "",
  });

  const sessions = useQuery({
    queryKey: ["cash-sessions", storeId],
    queryFn: () =>
      apiFetch<Session[]>(
        storeId ? `/api/v1/cash/sessions?storeId=${storeId}` : "/api/v1/cash/sessions",
      ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
  };

  const handleError = (caught: unknown) =>
    setError(caught instanceof ApiError ? caught.message : "Não foi possível concluir.");

  const open = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/cash/sessions", {
        method: "POST",
        body: { cashRegisterId: registerId, openingAmount: Number(openingAmount) },
      }),
    onSuccess: () => {
      setError(null);
      setOpening(false);
      setRegisterId("");
      setOpeningAmount("");
      invalidate();
    },
    onError: handleError,
  });

  const move = useMutation({
    mutationFn: () =>
      apiFetch(
        `/api/v1/cash/sessions/${movingSession?.id}/${
          movingSession?.kind === "sangria" ? "withdrawal" : "supply"
        }`,
        { method: "POST", body: { amount: Number(movementAmount), reason: movementReason } },
      ),
    onSuccess: () => {
      setError(null);
      setMovingSession(null);
      setMovementAmount("");
      setMovementReason("");
      invalidate();
    },
    onError: handleError,
  });

  /**
   * Abrir o fechamento busca só o que quem conta pode ver: código do turno,
   * quem abriu e quantas vendas. Nenhum valor — é o fechamento cego.
   */
  const startClosing = useMutation({
    mutationFn: (id: string) => apiFetch<ClosingInfo>(`/api/v1/cash/sessions/${id}/closing`),
    onSuccess: (info) => {
      setError(null);
      setClosingSession(info);
      setCountedAmount("");
      setDifferenceReason("");
    },
    onError: handleError,
  });

  const close = useMutation({
    mutationFn: () =>
      apiFetch<{
        code: string;
        countedAmount: string;
        expectedAmount: string;
        differenceAmount: string;
        conferido: boolean;
      }>(`/api/v1/cash/sessions/${closingSession?.id}/close`, {
        method: "POST",
        body: {
          countedAmount: Number(countedAmount),
          ...(differenceReason ? { differenceReason } : {}),
        },
      }),
    onSuccess: (result) => {
      setError(null);
      setCloseResult(result);
      setClosingSession(null);
      invalidate();
    },
    onError: handleError,
  });

  const availableRegisters = (stations.data ?? []).flatMap((station) =>
    station.cashRegisters.map((register) => ({
      id: register.id,
      label: `${station.name} — ${register.name}`,
    })),
  );

  return (
    <PageShell
      title="Caixa"
      description="Abertura, sangria e fechamento. A conferência é cega: você conta antes de ver o esperado."
      actions={
        opening ? null : (
          <Button type="button" onClick={() => setOpening(true)}>
            <LockOpen className="h-5 w-5" aria-hidden />
            Abrir caixa
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {closeResult && (
        <div className="mb-5">
          <Alert
            tone={closeResult.conferido ? "success" : "error"}
            title={`Caixa ${closeResult.code} fechado`}
          >
            <dl className="mt-2 grid gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-text-secondary">Você contou</dt>
                <dd className="font-medium">{formatMoney(closeResult.countedAmount)}</dd>
              </div>
              <div>
                <dt className="text-sm text-text-secondary">O sistema esperava</dt>
                <dd className="font-medium">{formatMoney(closeResult.expectedAmount)}</dd>
              </div>
              <div>
                <dt className="text-sm text-text-secondary">Diferença</dt>
                <dd className="font-medium">{formatMoney(closeResult.differenceAmount)}</dd>
              </div>
            </dl>
            <Button
              type="button"
              variant="ghost"
              className="mt-3"
              onClick={() => setCloseResult(null)}
            >
              Fechar
            </Button>
          </Alert>
        </div>
      )}

      {opening && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            open.mutate();
          }}
        >
          <h2 className="mb-4 font-medium text-text-primary">Abrir caixa</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="caixa">
                Caixa
              </label>
              <select
                id="caixa"
                required
                value={registerId}
                onChange={(event) => setRegisterId(event.target.value)}
                className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
              >
                <option value="">Selecione</option>
                {availableRegisters.map((register) => (
                  <option key={register.id} value={register.id}>
                    {register.label}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Fundo de troco (R$)"
              type="number"
              step="0.01"
              min={0}
              required
              value={openingAmount}
              onChange={(event) => setOpeningAmount(event.target.value)}
              hint="O dinheiro que já está na gaveta agora."
            />
          </div>

          {!storeId && (
            <p className="mt-4 text-sm text-text-secondary">
              Escolha a loja no filtro abaixo para os caixas dela aparecerem aqui.
            </p>
          )}

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={open.isPending}>
              Abrir
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpening(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {movingSession && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            move.mutate();
          }}
        >
          <h2 className="mb-4 font-medium text-text-primary">
            {movingSession.kind === "sangria" ? "Retirar dinheiro da gaveta" : "Reforçar o troco"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Valor (R$)"
              type="number"
              step="0.01"
              min={0.01}
              required
              value={movementAmount}
              onChange={(event) => setMovementAmount(event.target.value)}
            />
            <Field
              label={movingSession.kind === "sangria" ? "Para onde vai" : "De onde veio"}
              required
              value={movementReason}
              onChange={(event) => setMovementReason(event.target.value)}
              hint="Ex.: levado ao cofre, depósito no banco."
            />
          </div>

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={move.isPending}>
              Registrar
            </Button>
            <Button type="button" variant="outline" onClick={() => setMovingSession(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {closingSession && (
        <form
          className="mb-6 rounded-lg border-2 border-rose-primary bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            close.mutate();
          }}
        >
          <h2 className="mb-1 font-medium text-text-primary">
            Fechar o caixa {closingSession.code}
          </h2>
          <p className="mb-4 text-sm text-text-secondary">
            Aberto por {closingSession.openedByName} em {formatDateTime(closingSession.openedAt)} ·{" "}
            {closingSession.salesCount} venda(s).
          </p>

          <Alert tone="info">
            Conte todo o dinheiro da gaveta e digite o total. O valor que o sistema espera só
            aparece depois — é assim de propósito, para a contagem ser sua e não uma confirmação
            do que a tela já disse.
          </Alert>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Total contado (R$)"
              type="number"
              step="0.01"
              min={0}
              required
              autoFocus
              value={countedAmount}
              onChange={(event) => setCountedAmount(event.target.value)}
            />
            <Field
              label="Observação (se houver diferença)"
              value={differenceReason}
              onChange={(event) => setDifferenceReason(event.target.value)}
              hint="Obrigatória quando a contagem não bate."
            />
          </div>

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={close.isPending}>
              <Lock className="h-5 w-5" aria-hidden />
              Fechar caixa
            </Button>
            <Button type="button" variant="outline" onClick={() => setClosingSession(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <StorePicker storeId={storeId} onChange={setStoreId} todas className="mb-5 max-w-xs" />

      <ul className="space-y-3">
        {sessions.data?.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5"
          >
            <div>
              <p className="font-medium text-text-primary">
                {session.code} · {session.store.name} — {session.cashRegister.name}
              </p>
              <p className="text-sm text-text-secondary">
                Aberto por {session.openedBy.name} em {formatDateTime(session.openedAt)} ·{" "}
                {session._count.sales} venda(s)
              </p>

              {session.status === "FECHADO" && (
                <p className="mt-1 text-sm text-text-secondary">
                  Fechado por {session.closedBy?.name} · contado{" "}
                  {formatMoney(session.countedAmount)} · esperado{" "}
                  {formatMoney(session.expectedAmount)}
                  {Number(session.differenceAmount ?? 0) !== 0 && (
                    <strong className="ml-1 text-danger">
                      diferença de {formatMoney(session.differenceAmount)}
                    </strong>
                  )}
                </p>
              )}

              {session.differenceReason && (
                <p className="mt-1 text-sm text-text-muted">“{session.differenceReason}”</p>
              )}

              {/*
                Diz que passou do limite, nunca quanto tem na gaveta: a
                contagem do fechamento é às cegas, e o valor exato na tela
                desfaria a conferência.
              */}
              {session.sangriaSugerida?.passou && (
                <p className="mt-2 flex items-center gap-2 text-sm font-medium text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  Passou de {formatMoney(session.sangriaSugerida.limite)} em dinheiro. Faça uma
                  sangria.
                </p>
              )}
            </div>

            {session.status === "ABERTO" && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMovingSession({ id: session.id, kind: "sangria" });
                    setClosingSession(null);
                  }}
                >
                  <ArrowUpCircle className="h-5 w-5" aria-hidden />
                  Sangria
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMovingSession({ id: session.id, kind: "suprimento" });
                    setClosingSession(null);
                  }}
                >
                  <ArrowDownCircle className="h-5 w-5" aria-hidden />
                  Suprimento
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={startClosing.isPending}
                  onClick={() => {
                    setMovingSession(null);
                    startClosing.mutate(session.id);
                  }}
                >
                  <Lock className="h-5 w-5" aria-hidden />
                  Fechar
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {sessions.data?.length === 0 && (
        <Alert tone="info">Nenhum turno de caixa registrado ainda.</Alert>
      )}
    </PageShell>
  );
}
