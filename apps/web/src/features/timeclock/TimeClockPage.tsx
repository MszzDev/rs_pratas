import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, LogIn, LogOut, Coffee, Undo2 } from "lucide-react";
import type { TimeClockEventType } from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";
import { readDeviceId } from "@/lib/secure-storage";
import { useAuth } from "../auth/auth-context";

interface NextEventResponse {
  suggestedType: TimeClockEventType;
  lastEntry: { type: TimeClockEventType; timestamp: string; nsr: string } | null;
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

const EVENT_ICONS = {
  CLOCK_IN: LogIn,
  CLOCK_OUT: LogOut,
  BREAK_START: Coffee,
  BREAK_END: Undo2,
} satisfies Record<TimeClockEventType, typeof Clock>;

function eventLabel(type: TimeClockEventType): string {
  return EVENT_LABELS[type];
}

/** Rótulo curto para o comprovante e para os botões secundários. */
function shortEventLabel(type: TimeClockEventType): string {
  return eventLabel(type).replace("Registrar ", "").replace("Iniciar ", "");
}

/** Saída e início de intervalo pedem justificativa. */
const NEEDS_JUSTIFICATION: TimeClockEventType[] = ["CLOCK_OUT", "BREAK_START"];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function TimeClockPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const [justification, setJustification] = useState("");
  const [receipt, setReceipt] = useState<PunchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["timeclock", "next"],
    queryFn: () => apiFetch<NextEventResponse>("/api/v1/timeclock/next"),
  });

  const punch = useMutation({
    mutationFn: async (type: TimeClockEventType) => {
      const deviceId = await readDeviceId();
      if (!deviceId) {
        throw new Error("Este aparelho não está vinculado a uma loja.");
      }

      return apiFetch<PunchResponse>("/api/v1/timeclock/punch", {
        method: "POST",
        body: {
          deviceId,
          type,
          clientTimestamp: new Date().toISOString(),
          ...(justification.trim() ? { justification: justification.trim() } : {}),
        },
      });
    },
    onSuccess: (result) => {
      setReceipt(result);
      setJustification("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["timeclock", "next"] });
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Não foi possível registrar agora. Avise o gerente.",
      );
    },
  });

  const suggested = data?.suggestedType ?? "CLOCK_IN";
  const Icon = EVENT_ICONS[suggested];
  const requiresJustification = NEEDS_JUSTIFICATION.includes(suggested);

  return (
    <main className="min-h-screen bg-background-secondary px-4 py-8">
      <div className="mx-auto max-w-lg">
        <header className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Olá, {user?.name}</h1>
            <p className="text-text-secondary">Matrícula {user?.employeeCode}</p>
          </div>
          <Button variant="ghost" onClick={() => void logout()}>
            Sair
          </Button>
        </header>

        {receipt && (
          <div className="mb-5">
            <Alert
              tone={receipt.justificationPending ? "info" : "success"}
              title={`${shortEventLabel(receipt.type)} às ${formatTime(receipt.timestamp)}`}
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

        <section className="rounded-lg border border-border bg-surface p-7">
          {data?.lastEntry && (
            <p className="mb-5 text-sm text-text-muted">
              Última marcação: {shortEventLabel(data.lastEntry.type)} às{" "}
              {formatTime(data.lastEntry.timestamp)}
            </p>
          )}

          {requiresJustification && (
            <div className="mb-5">
              <Field
                label="Motivo"
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                hint="Obrigatório ao sair durante o turno. Se não informar agora, a marcação fica pendente de justificativa — mas é registrada mesmo assim."
              />
            </div>
          )}

          <Button
            size="lg"
            className="w-full"
            disabled={isLoading || punch.isPending}
            onClick={() => punch.mutate(suggested)}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {punch.isPending ? "Registrando..." : eventLabel(suggested)}
          </Button>

          <p className="mt-4 text-center text-sm text-text-muted">
            Precisa registrar outra coisa?
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(Object.keys(EVENT_LABELS) as TimeClockEventType[])
              .filter((type) => type !== suggested)
              .map((type) => (
                <Button
                  key={type}
                  variant="outline"
                  disabled={punch.isPending}
                  onClick={() => punch.mutate(type)}
                >
                  {shortEventLabel(type)}
                </Button>
              ))}
          </div>
        </section>

        <p className="mt-5 text-center text-sm text-text-muted">
          Nenhuma marcação é recusada. Correções só podem ser feitas pelo gerente, e ficam
          registradas ao lado do original.
        </p>
      </div>
    </main>
  );
}
