import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, Tablet } from "lucide-react";
import type { SessionSummary } from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "./auth-context";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function SessionsPage() {
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: () => apiFetch<SessionSummary[]>("/api/v1/auth/sessions"),
  });

  const revoke = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch(`/api/v1/auth/sessions/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível encerrar."),
  });

  const revokeAll = useMutation({
    mutationFn: () => apiFetch("/api/v1/auth/logout-all", { method: "POST" }),
    // Encerrar todas inclui a atual: leva de volta ao login em vez de deixar a
    // tela num estado que não existe mais.
    onSuccess: () => void logout(),
  });

  return (
    <PageShell
      title="Onde você está conectado"
      description="Cada aparelho em que sua conta está aberta agora."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <ul className="space-y-3">
        {sessions.data?.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5"
          >
            <div className="flex items-start gap-3">
              {session.deviceId ? (
                <Tablet className="mt-1 h-5 w-5 text-text-secondary" aria-hidden />
              ) : (
                <Monitor className="mt-1 h-5 w-5 text-text-secondary" aria-hidden />
              )}

              <div>
                <p className="font-medium text-text-primary">
                  {session.deviceName ?? "Computador ou celular"}
                  {session.current && (
                    <span className="ml-2 rounded bg-rose-soft px-2 py-0.5 text-sm text-rose-dark">
                      esta sessão
                    </span>
                  )}
                </p>
                <p className="text-sm text-text-secondary">
                  Última atividade em {formatDateTime(session.lastUsedAt)}
                </p>
                {session.ipAddress && (
                  <p className="text-sm text-text-muted">Endereço {session.ipAddress}</p>
                )}
              </div>
            </div>

            {!session.current && (
              <Button
                type="button"
                variant="outline"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(session.id)}
              >
                Encerrar
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6 border-t border-border pt-6">
        <p className="mb-3 text-sm text-text-secondary">
          Perdeu um aparelho ou desconfia de acesso indevido? Encerrar todas desconecta você de
          todos os lugares, inclusive daqui.
        </p>
        <Button
          type="button"
          variant="danger"
          disabled={revokeAll.isPending}
          onClick={() => revokeAll.mutate()}
        >
          <LogOut className="h-5 w-5" aria-hidden />
          Encerrar todas as sessões
        </Button>
      </div>
    </PageShell>
  );
}
