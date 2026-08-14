import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, PenLine } from "lucide-react";
import type { TimeClockEventType } from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "../auth/auth-context";

interface Correction {
  id: string;
  nsr: string;
  type: TimeClockEventType;
  timestamp: string;
  reason: string | null;
}

interface MirrorEntry {
  id: string;
  nsr: string;
  type: TimeClockEventType;
  timestamp: string;
  isWithinTolerance: boolean | null;
  minutesLate: number | null;
  justification: string | null;
  justificationPending: boolean;
  corrections: Correction[];
}

interface Mirror {
  user: { id: string; name: string; employeeCode: string };
  entries: MirrorEntry[];
}

interface UserRow {
  id: string;
  name: string;
  employeeCode: string;
  role: string;
}

const EVENT_LABELS: Record<TimeClockEventType, string> = {
  CLOCK_IN: "Entrada",
  CLOCK_OUT: "Saída",
  BREAK_START: "Início do intervalo",
  BREAK_END: "Volta do intervalo",
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function TimeSheetPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canSeeOthers = ["DONO", "GERENTE", "DESENVOLVEDOR"].includes(user?.role ?? "");

  const [targetUserId, setTargetUserId] = useState("");
  const [correcting, setCorrecting] = useState<MirrorEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserRow[]>("/api/v1/users"),
    enabled: canSeeOthers,
  });

  const viewingSelf = !targetUserId || targetUserId === user?.id;

  const mirror = useQuery({
    queryKey: ["timesheet", targetUserId || "me"],
    queryFn: () =>
      apiFetch<Mirror>(
        viewingSelf
          ? "/api/v1/timeclock/me/mirror"
          : `/api/v1/timeclock/users/${targetUserId}/mirror`,
      ),
  });

  const correct = useMutation({
    mutationFn: (params: { entryId: string; type: string; timestamp: string; reason: string }) =>
      apiFetch(`/api/v1/timeclock/entries/${params.entryId}/correct`, {
        method: "POST",
        body: {
          type: params.type,
          timestamp: new Date(params.timestamp).toISOString(),
          reason: params.reason,
        },
      }),
    onSuccess: () => {
      setCorrecting(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["timesheet"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível corrigir."),
  });

  return (
    <PageShell
      title="Espelho de ponto"
      description="Todas as marcações, com as correções ao lado das originais."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {canSeeOthers && (
        <div className="mb-6 max-w-sm">
          <label htmlFor="funcionario" className="text-sm font-medium text-text-secondary">
            Funcionário
          </label>
          <select
            id="funcionario"
            value={targetUserId}
            onChange={(event) => setTargetUserId(event.target.value)}
            className="mt-1.5 min-h-[48px] w-full rounded-md border border-border bg-surface px-4"
          >
            <option value="">Eu mesmo</option>
            {users.data
              ?.filter((entry) => entry.id !== user?.id)
              .map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} ({entry.employeeCode})
                </option>
              ))}
          </select>
        </div>
      )}

      {mirror.data?.entries.length === 0 && (
        <Alert tone="info">Nenhuma marcação registrada no período.</Alert>
      )}

      <ul className="space-y-3">
        {mirror.data?.entries.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-text-primary">
                  {EVENT_LABELS[entry.type]} · {formatDateTime(entry.timestamp)}
                </p>
                <p className="text-sm text-text-muted">Registro nº {entry.nsr}</p>

                {entry.minutesLate !== null && entry.minutesLate > 0 && (
                  <p
                    className={`mt-1 text-sm ${
                      entry.isWithinTolerance ? "text-text-secondary" : "text-warning"
                    }`}
                  >
                    {entry.minutesLate} min após o horário
                    {entry.isWithinTolerance ? " — dentro da tolerância" : " de atraso"}
                  </p>
                )}

                {entry.justification && (
                  <p className="mt-1 text-sm text-text-secondary">
                    Justificativa: {entry.justification}
                  </p>
                )}
              </div>

              {entry.justificationPending && (
                <span className="flex items-center gap-1.5 text-sm text-warning">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  Falta justificar
                </span>
              )}
            </div>

            {entry.corrections.length > 0 && (
              <ul className="mt-4 space-y-2 border-l-2 border-rose-light pl-4">
                {entry.corrections.map((correction) => (
                  <li key={correction.id} className="text-sm">
                    <p className="font-medium text-rose-dark">
                      Correção · {EVENT_LABELS[correction.type]} ·{" "}
                      {formatDateTime(correction.timestamp)}
                    </p>
                    <p className="text-text-secondary">{correction.reason}</p>
                    <p className="text-text-muted">Registro nº {correction.nsr}</p>
                  </li>
                ))}
              </ul>
            )}

            {canSeeOthers && !viewingSelf && (
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() => setCorrecting(entry)}
              >
                <PenLine className="h-4 w-4" aria-hidden />
                Registrar correção
              </Button>
            )}
          </li>
        ))}
      </ul>

      {correcting && (
        <CorrectionDialog
          entry={correcting}
          pending={correct.isPending}
          onCancel={() => setCorrecting(null)}
          onConfirm={(values) => correct.mutate({ entryId: correcting.id, ...values })}
        />
      )}

      <p className="mt-6 text-sm text-text-muted">
        A marcação original nunca é alterada nem apagada. A correção entra como um registro novo,
        e os dois ficam visíveis — é isso que dá validade ao espelho.
      </p>
    </PageShell>
  );
}

function CorrectionDialog({
  entry,
  pending,
  onCancel,
  onConfirm,
}: {
  entry: MirrorEntry;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (values: { type: string; timestamp: string; reason: string }) => void;
}) {
  const [type, setType] = useState<string>(entry.type);
  const [timestamp, setTimestamp] = useState(() =>
    new Date(entry.timestamp).toISOString().slice(0, 16),
  );
  const [reason, setReason] = useState("");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="correcao-titulo"
      className="fixed inset-0 z-40 flex items-center justify-center bg-text-primary/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <h2 id="correcao-titulo" className="text-xl font-semibold text-text-primary">
          Registrar correção
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Corrigindo o registro nº {entry.nsr}, de {formatDateTime(entry.timestamp)}.
        </p>

        <form
          className="mt-5 flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm({ type, timestamp, reason });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tipo" className="text-sm font-medium text-text-secondary">
              Tipo correto
            </label>
            <select
              id="tipo"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="min-h-[48px] rounded-md border border-border bg-surface px-4"
            >
              {(Object.keys(EVENT_LABELS) as TimeClockEventType[]).map((option) => (
                <option key={option} value={option}>
                  {EVENT_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <Field
            label="Horário correto"
            type="datetime-local"
            value={timestamp}
            onChange={(event) => setTimestamp(event.target.value)}
            required
          />

          <Field
            label="Motivo"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="Obrigatório. Fica registrado ao lado da marcação original."
            required
            minLength={5}
          />

          <div className="flex gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Registrando..." : "Registrar correção"}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
