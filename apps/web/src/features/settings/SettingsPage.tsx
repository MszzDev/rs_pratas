import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { EmailStatus } from "./EmailStatus";
import { PrinterSettings } from "@/features/printing/PrinterSettings";

interface Setting {
  id: string;
  key: string;
  value: unknown;
  description?: string | null;
}

/**
 * Configurações conhecidas da empresa.
 *
 * A API aceita qualquer chave — é um armazém de chave/valor. A tela mostra só
 * este conjunto porque um campo livre convida a errar o nome da chave, e uma
 * chave errada não dá erro: ela simplesmente nunca é lida por ninguém.
 */
const KNOWN_SETTINGS: Array<{
  key: string;
  label: string;
  hint: string;
  type: "number" | "text";
  suffix?: string;
}> = [
  {
    key: "inactivity_lock_seconds",
    label: "Bloquear o tablet após inatividade",
    hint: "Tempo sem toque até a tela pedir o PIN de novo. O balcão fica sozinho o tempo todo.",
    type: "number",
    suffix: "segundos",
  },
  {
    key: "cash_limit_amount",
    label: "Limite de dinheiro no caixa",
    hint: "Passando disso, o sistema pede uma sangria. Dinheiro parado na gaveta é o que um assalto leva.",
    type: "number",
    suffix: "reais",
  },
  {
    key: "timeclock_tolerance_minutes",
    label: "Tolerância padrão de ponto",
    hint: "Usada quando a jornada do funcionário não define uma própria.",
    type: "number",
    suffix: "minutos",
  },
  {
    key: "document_review_sla_hours",
    label: "Prazo para conferir documento",
    hint: "Depois disso o atestado pendente aparece destacado na tela de conferência.",
    type: "number",
    suffix: "horas",
  },
  {
    key: "receipt_footer",
    label: "Rodapé do comprovante",
    hint: "Texto impresso no fim de cada comprovante. Ex.: trocas em até 7 dias com a etiqueta.",
    type: "text",
  },
];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ["settings", "app"],
    queryFn: () => apiFetch<Setting[]>("/api/v1/settings/app"),
  });

  const stored = new Map((settings.data ?? []).map((row) => [row.key, row.value]));

  const save = useMutation({
    mutationFn: (params: { key: string; value: unknown; description: string }) =>
      apiFetch("/api/v1/settings/app", { method: "PUT", body: params }),
    onSuccess: (_result, params) => {
      setError(null);
      setSaved(params.key);
      void queryClient.invalidateQueries({ queryKey: ["settings", "app"] });
    },
    onError: (caught) => {
      setSaved(null);
      setError(caught instanceof ApiError ? caught.message : "Não foi possível salvar.");
    },
  });

  return (
    <PageShell
      title="Configurações"
      description="Valores que valem para a empresa inteira. Lojas e tablets podem ter os seus próprios."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <EmailStatus />

      {/*
        Some sozinha no computador do dono: impressora de balcão é assunto de
        tablet, e a seção vazia lá só levantaria a dúvida do que está faltando.
      */}
      <div className="mb-5">
        <PrinterSettings />
      </div>

      <div className="space-y-4">
        {KNOWN_SETTINGS.map((setting) => {
          const current = stored.get(setting.key);
          const draft = drafts[setting.key] ?? (current === undefined ? "" : String(current));
          const changed = draft !== (current === undefined ? "" : String(current));

          return (
            <div key={setting.key} className="rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-wrap items-end gap-4">
                <div className="min-w-[16rem] flex-1">
                  <Field
                    label={setting.label}
                    type={setting.type}
                    value={draft}
                    onChange={(event) =>
                      setDrafts({ ...drafts, [setting.key]: event.target.value })
                    }
                    hint={setting.suffix ? `${setting.hint} Em ${setting.suffix}.` : setting.hint}
                  />
                </div>

                <Button
                  type="button"
                  disabled={!changed || save.isPending}
                  onClick={() =>
                    save.mutate({
                      key: setting.key,
                      // Número vai como número: o consumidor não deveria ter que
                      // adivinhar se "30" é texto ou quantidade.
                      value: setting.type === "number" ? Number(draft) : draft,
                      description: setting.label,
                    })
                  }
                >
                  Salvar
                </Button>
              </div>

              {saved === setting.key && !changed && (
                <p className="mt-3 text-sm text-success">Salvo.</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-sm text-text-secondary">
        Toda alteração aqui fica registrada na auditoria, com quem mudou, quando, e o valor
        anterior.
      </p>
    </PageShell>
  );
}
