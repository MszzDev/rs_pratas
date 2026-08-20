import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Coffee, LogIn, LogOut, Undo2 } from "lucide-react";
import type { TimeClockEventType } from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { readDeviceId } from "@/lib/secure-storage";
import { useAuth } from "../auth/auth-context";

interface TodayEntry {
  id: string;
  nsr: string;
  type: TimeClockEventType;
  timestamp: string;
  justification: string | null;
}

interface NextEventResponse {
  suggestedType: TimeClockEventType;
  allowedTypes: TimeClockEventType[];
  lastEntry: { type: TimeClockEventType; timestamp: string; nsr: string } | null;
  workedMinutes: number;
  shortDay: boolean;
  minimumMinutes: number;
  todayEntries: TodayEntry[];
}

interface PunchResponse {
  nsr: string;
  type: TimeClockEventType;
  timestamp: string;
  isWithinTolerance: boolean | null;
  minutesLate: number | null;
  justificationPending: boolean;
}

const EVENT_LABELS: Record<TimeClockEventType, string> = {
  CLOCK_IN: "Registrar entrada",
  CLOCK_OUT: "Registrar saída",
  BREAK_START: "Iniciar intervalo",
  BREAK_END: "Voltar do intervalo",
};

const SHORT_LABELS: Record<TimeClockEventType, string> = {
  CLOCK_IN: "Entrada",
  CLOCK_OUT: "Saída",
  BREAK_START: "Intervalo",
  BREAK_END: "Volta do intervalo",
};

const EVENT_ICONS = {
  CLOCK_IN: LogIn,
  CLOCK_OUT: LogOut,
  BREAK_START: Coffee,
  BREAK_END: Undo2,
} satisfies Record<TimeClockEventType, typeof Clock>;

/**
 * Motivos prontos para o intervalo.
 *
 * Quase toda pausa é uma destas, e digitar "almoço" no tablet toda vez é
 * trabalho à toa. "Outro" abre o campo livre — o que não cabe na lista continua
 * cabendo no ponto.
 */
const MOTIVOS_INTERVALO = ["Almoço", "Café", "Banco / pessoal", "Consulta médica"];

/** Sair antes de fechar a jornada mínima é o caso que pede explicação. */
const MOTIVOS_SAIDA = [
  "Fim do expediente",
  "Consulta médica",
  "Assunto pessoal",
  "Dispensado pela gerência",
];

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const formatDuration = (minutos: number) => {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  if (horas === 0) return `${resto} min`;
  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, "0")}`;
};

/** Cor por tipo de marcação — a linha do dia se lê de relance. */
const TONE: Record<TimeClockEventType, string> = {
  CLOCK_IN: "bg-emerald-500",
  BREAK_START: "bg-amber-500",
  BREAK_END: "bg-sky-500",
  CLOCK_OUT: "bg-rose-primary",
};

export function TimeClockPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [escolhido, setEscolhido] = useState<TimeClockEventType | null>(null);
  const [motivo, setMotivo] = useState("");
  const [motivoLivre, setMotivoLivre] = useState("");
  const [receipt, setReceipt] = useState<PunchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["timeclock", "next"],
    queryFn: () => apiFetch<NextEventResponse>("/api/v1/timeclock/next"),
  });

  const fechar = () => {
    setEscolhido(null);
    setMotivo("");
    setMotivoLivre("");
  };

  const punch = useMutation({
    mutationFn: async (params: { type: TimeClockEventType; justification?: string }) => {
      // Manda o tablet quando existe um. No computador da loja não existe, e a
      // batida vale do mesmo jeito — o servidor identifica a loja pelo vínculo
      // do funcionário.
      const deviceId = await readDeviceId();

      return apiFetch<PunchResponse>("/api/v1/timeclock/punch", {
        method: "POST",
        body: {
          ...(deviceId ? { deviceId } : {}),
          type: params.type,
          clientTimestamp: new Date().toISOString(),
          ...(params.justification ? { justification: params.justification } : {}),
        },
      });
    },
    onSuccess: (result) => {
      setReceipt(result);
      setError(null);
      fechar();
      void queryClient.invalidateQueries({ queryKey: ["timeclock", "next"] });
    },
    onError: (caught) => {
      // A mensagem do servidor diz o que fazer. Trocá-la por um texto genérico
      // deixaria o funcionário sem saber a quem recorrer.
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Não foi possível registrar agora. Avise o gerente.",
      );
    },
  });

  const permitidos = data?.allowedTypes ?? ["CLOCK_IN"];
  const principal = data?.suggestedType ?? "CLOCK_IN";
  const trabalhados = data?.workedMinutes ?? 0;
  const secundarios = permitidos.filter((type) => type !== principal);

  /** Motivo é obrigatório no intervalo e na saída antecipada. */
  const motivoObrigatorio =
    escolhido === "BREAK_START" || (escolhido === "CLOCK_OUT" && (data?.shortDay ?? false));

  const opcoes = escolhido === "BREAK_START" ? MOTIVOS_INTERVALO : MOTIVOS_SAIDA;
  const textoFinal = motivo === "Outro" ? motivoLivre.trim() : motivo;
  const podeConfirmar = !motivoObrigatorio || textoFinal.length >= 3;

  const bater = (type: TimeClockEventType) => {
    setReceipt(null);
    // Intervalo e saída passam pela tela de motivo; entrada e volta não têm o
    // que explicar e vão direto.
    if (type === "BREAK_START" || type === "CLOCK_OUT") {
      setEscolhido(type);
      return;
    }
    punch.mutate({ type });
  };

  const IconePrincipal = EVENT_ICONS[principal];

  return (
    <PageShell
      title={`Olá, ${user?.name?.split(" ")[0] ?? ""}`}
      description={`Matrícula ${user?.employeeCode ?? ""}`}
    >
      <div className="mx-auto max-w-lg">
        {receipt && (
          <div className="mb-5">
            <Alert
              tone={receipt.justificationPending ? "info" : "success"}
              title={`${SHORT_LABELS[receipt.type]} às ${formatTime(receipt.timestamp)}`}
            >
              <p>Registro nº {receipt.nsr} gravado.</p>
              {receipt.minutesLate !== null && receipt.minutesLate > 0 && (
                <p>
                  {receipt.isWithinTolerance
                    ? `${receipt.minutesLate} min após o horário — dentro da tolerância.`
                    : `${receipt.minutesLate} min de atraso.`}
                </p>
              )}
              {receipt.justificationPending && (
                <p>Falta justificar esta marcação. Procure o gerente para registrar o motivo.</p>
              )}
            </Alert>
          </div>
        )}

        {error && (
          <div className="mb-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {/* Onde a pessoa está no dia, antes de qualquer botão. */}
        <section className="mb-5 rounded-lg border border-border bg-gradient-to-br from-rose-soft/70 to-surface p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-dark">Hoje</p>
              <p className="mt-0.5 text-3xl font-semibold text-text-primary">
                {formatDuration(trabalhados)}
              </p>
              <p className="text-sm text-text-secondary">trabalhadas até agora</p>
            </div>
            {data?.lastEntry && (
              <p className="text-right text-sm text-text-secondary">
                Última marcação
                <br />
                <span className="font-medium text-text-primary">
                  {SHORT_LABELS[data.lastEntry.type]} às {formatTime(data.lastEntry.timestamp)}
                </span>
              </p>
            )}
          </div>

          {(data?.todayEntries.length ?? 0) > 0 && (
            <ol className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-border/60 pt-3">
              {data?.todayEntries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-1.5 text-sm">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${TONE[entry.type]}`}
                    aria-hidden
                  />
                  <span className="text-text-secondary">{SHORT_LABELS[entry.type]}</span>
                  <span className="font-medium text-text-primary">
                    {formatTime(entry.timestamp)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-6 shadow-soft">
          {escolhido ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                punch.mutate({
                  type: escolhido,
                  ...(textoFinal ? { justification: textoFinal } : {}),
                });
              }}
            >
              <h2 className="mb-1 font-medium text-text-primary">{EVENT_LABELS[escolhido]}</h2>
              <p className="mb-4 text-sm text-text-secondary">
                {escolhido === "BREAK_START"
                  ? "O que você vai fazer? O intervalo não conta como hora trabalhada."
                  : data?.shortDay
                    ? `Você tem ${formatDuration(trabalhados)} hoje, menos que as ${formatDuration(
                        data.minimumMinutes,
                      )} previstas. Diga o motivo da saída.`
                    : "Pode dizer o motivo, se quiser."}
              </p>

              <div className="mb-4 grid gap-2 sm:grid-cols-2">
                {[...opcoes, "Outro"].map((opcao) => (
                  <button
                    key={opcao}
                    type="button"
                    onClick={() => setMotivo(opcao)}
                    className={`min-h-[52px] rounded-md border px-3 text-left text-sm font-medium transition-colors ${
                      motivo === opcao
                        ? "border-rose-primary bg-rose-soft text-rose-dark"
                        : "border-border bg-surface text-text-secondary hover:border-rose-primary/60"
                    }`}
                  >
                    {opcao}
                  </button>
                ))}
              </div>

              {motivo === "Outro" && (
                <div className="mb-4">
                  <Field
                    label="Qual o motivo?"
                    autoFocus
                    value={motivoLivre}
                    onChange={(event) => setMotivoLivre(event.target.value)}
                  />
                </div>
              )}

              {motivoObrigatorio && !podeConfirmar && (
                <p className="mb-3 text-sm text-text-muted">
                  Escolha um motivo para continuar. Se nenhum servir, use &ldquo;Outro&rdquo;.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="lg" disabled={!podeConfirmar || punch.isPending}>
                  {punch.isPending ? "Registrando..." : "Confirmar"}
                </Button>
                <Button type="button" variant="outline" size="lg" onClick={fechar}>
                  Voltar
                </Button>
              </div>

              {!motivoObrigatorio && (
                <p className="mt-3 text-sm text-text-muted">
                  Sem motivo a marcação entra assim mesmo, marcada como pendente de justificativa
                  — nenhuma batida é recusada.
                </p>
              )}
            </form>
          ) : (
            <>
              <Button
                size="lg"
                className="w-full"
                disabled={isLoading || punch.isPending}
                onClick={() => bater(principal)}
              >
                <IconePrincipal className="h-5 w-5" aria-hidden />
                {EVENT_LABELS[principal]}
              </Button>

              {/*
                Só o que faz sentido agora. Quem já entrou não vê "registrar
                entrada" — antes as quatro opções apareciam sempre, e bater
                entrada duas vezes era um toque de distância.
              */}
              {secundarios.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {secundarios.map((type) => {
                    const Icone = EVENT_ICONS[type];
                    return (
                      <Button
                        key={type}
                        variant="outline"
                        size="lg"
                        disabled={punch.isPending}
                        onClick={() => bater(type)}
                      >
                        <Icone className="h-5 w-5" aria-hidden />
                        {EVENT_LABELS[type]}
                      </Button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>

        <p className="mt-5 text-center text-sm text-text-muted">
          Nenhuma marcação é recusada. Correções são feitas pelo dono e ficam registradas ao lado
          do original — a marcação errada continua lá.
        </p>
      </div>
    </PageShell>
  );
}
