import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FileDown, PenLine, Printer } from "lucide-react";
import type { TimeClockEventType } from "@rs-pratas/shared";
import { formatDuration } from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "../auth/auth-context";
import type { DiaDeTrabalho, ReportEntry } from "./timesheet-report";
import { agruparPorDia, baixar, paraCsv } from "./timesheet-report";

/**
 * A linha do espelho é a mesma que o relatório exporta — uma definição só.
 * Duas interfaces idênticas em arquivos diferentes divergem no primeiro campo
 * novo, e o erro só aparece na hora de exportar.
 */
type MirrorEntry = ReportEntry;

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

/** Cor por tipo de marcação — a mesma da tela de bater ponto. */
const TONE: Record<TimeClockEventType, string> = {
  CLOCK_IN: "bg-emerald-500",
  BREAK_START: "bg-amber-500",
  BREAK_END: "bg-sky-500",
  CLOCK_OUT: "bg-rose-primary",
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

  const dias = useMemo(
    () => agruparPorDia(mirror.data?.entries ?? []),
    [mirror.data?.entries],
  );

  const exportarCsv = () => {
    const alvo = mirror.data?.user;
    if (!alvo) return;

    baixar(
      `espelho-de-ponto-${alvo.employeeCode}.csv`,
      paraCsv(alvo.name, alvo.employeeCode, dias),
      "text/csv;charset=utf-8",
    );
  };

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
      actions={
        dias.length > 0 && (
          <div className="flex gap-2 print:hidden">
            <Button type="button" variant="outline" onClick={exportarCsv}>
              <FileDown className="h-5 w-5" aria-hidden />
              Excel
            </Button>
            {/*
              PDF sai pela impressão do navegador ("Salvar como PDF" no destino).
              É o mesmo caminho das etiquetas: o navegador já sabe paginar e
              embutir fonte, e uma biblioteca de PDF no pacote custaria centenas
              de KB para reproduzir isso pior.
            */}
            <Button type="button" variant="outline" onClick={() => window.print()}>
              <Printer className="h-5 w-5" aria-hidden />
              PDF
            </Button>
          </div>
        )
      }
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

      {/*
        No papel o documento precisa se identificar sozinho: quem assina o
        espelho não tem a tela do lado para saber de quem é a folha.
      */}
      {mirror.data && (
        <div className="mb-6 hidden print:block">
          <h2 className="text-lg font-semibold">Espelho de ponto — {mirror.data.user.name}</h2>
          <p className="text-sm">
            Matrícula {mirror.data.user.employeeCode} · emitido em{" "}
            {new Date().toLocaleString("pt-BR")}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {dias.map((dia) => (
          <section key={dia.data} className="rounded-lg border border-border bg-surface p-5">
            <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium capitalize text-text-primary">{dia.rotulo}</h2>
              <p className="text-sm text-text-secondary">
                <span className="font-semibold text-text-primary">
                  {formatDuration(dia.minutosTrabalhados)}
                </span>{" "}
                trabalhadas
              </p>
            </header>

            <DayBar dia={dia} />

            <ul className="mt-4 space-y-3">
              {dia.entries.map((entry) => (
                <li key={entry.id} className="border-t border-border/60 pt-3 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-text-primary">
                        <span
                          className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${TONE[entry.type]}`}
                          aria-hidden
                        />
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
                          Motivo: {entry.justification}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {entry.justificationPending && (
                        <span className="flex items-center gap-1.5 text-sm text-warning">
                          <AlertTriangle className="h-4 w-4" aria-hidden />
                          Falta justificar
                        </span>
                      )}

                      {canSeeOthers && !viewingSelf && (
                        <Button
                          type="button"
                          variant="outline"
                          className="print:hidden"
                          onClick={() => setCorrecting(entry)}
                        >
                          <PenLine className="h-4 w-4" aria-hidden />
                          Corrigir
                        </Button>
                      )}
                    </div>
                  </div>

                  {entry.corrections.length > 0 && (
                    <ul className="mt-3 space-y-2 border-l-2 border-rose-light pl-4">
                      {entry.corrections.map((correction) => (
                        <li key={correction.id} className="text-sm">
                          <p className="font-medium text-rose-dark">
                            Correção · {EVENT_LABELS[correction.type]} ·{" "}
                            {formatDateTime(correction.timestamp)}
                          </p>
                          <p className="text-text-muted">Registro nº {correction.nsr}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

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

/**
 * O dia inteiro numa barra.
 *
 * A escala vai da primeira à última marcação, com meia hora de folga dos dois
 * lados — fixar em 00h–24h espremeria o expediente num quinto da largura e
 * jogaria fora justamente a informação que interessa. Verde é tempo
 * trabalhado, âmbar é intervalo.
 */
function DayBar({ dia }: { dia: DiaDeTrabalho }) {
  const de = Math.max(0, dia.inicio - 30);
  const ate = Math.min(24 * 60, Math.max(dia.fim + 30, de + 60));
  const largura = ate - de;
  const pct = (minuto: number) => ((minuto - de) / largura) * 100;

  const hora = (minuto: number) =>
    `${String(Math.floor(minuto / 60)).padStart(2, "0")}:${String(minuto % 60).padStart(2, "0")}`;

  return (
    <div>
      <div className="relative h-6 overflow-hidden rounded-full bg-background-secondary">
        {dia.faixas.map((faixa, indice) => (
          <div
            key={`${faixa.tipo}-${faixa.de}-${indice}`}
            title={`${faixa.tipo === "trabalho" ? "Trabalhando" : "Intervalo"} · ${hora(
              faixa.de,
            )} às ${hora(faixa.ate)}`}
            className={`absolute inset-y-0 ${
              faixa.tipo === "trabalho"
                ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                : "bg-amber-300"
            }`}
            style={{
              left: `${pct(faixa.de)}%`,
              width: `${Math.max(0.5, pct(faixa.ate) - pct(faixa.de))}%`,
            }}
          />
        ))}
      </div>

      <div className="mt-1 flex justify-between text-xs text-text-muted">
        <span>{hora(de)}</span>
        <span>{hora(ate)}</span>
      </div>
    </div>
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
