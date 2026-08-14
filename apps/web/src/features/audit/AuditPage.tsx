import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch } from "@/lib/api-client";

interface AuditEntry {
  id: string;
  action: string;
  result: "SUCCESS" | "FAILURE" | "DENIED";
  entityType: string | null;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
  userRoleSnapshot: string | null;
  user: { name: string; employeeCode: string } | null;
}

/**
 * Rótulos em português para os eventos. Sem isso a tela mostraria
 * LOGIN_FAILED cru, e quem investiga um incidente não deveria precisar
 * traduzir constante de código.
 */
const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Entrou no sistema",
  LOGIN_FAILED: "Tentativa de entrada recusada",
  LOGOUT: "Saiu do sistema",
  LOGOUT_ALL: "Encerrou todas as sessões",
  PASSWORD_CHANGE: "Senha alterada",
  PIN_SET: "PIN criado",
  FIRST_ACCESS_COMPLETED: "Primeiro acesso concluído",
  USER_CREATE: "Funcionário cadastrado",
  USER_UPDATE: "Funcionário alterado",
  USER_BLOCK: "Funcionário bloqueado",
  USER_UNBLOCK: "Funcionário desbloqueado",
  USER_PROMOTE_TO_OWNER: "Promovido a dono",
  USER_ROLE_CHANGE: "Perfil alterado",
  PERMISSION_GRANT: "Permissão concedida",
  PERMISSION_REVOKE: "Permissão revogada",
  PERMISSION_DENIED: "Acesso negado por falta de permissão",
  DEVICE_PAIR_INITIATED: "Tablet cadastrado",
  DEVICE_PAIR_CLAIMED: "Tablet vinculado",
  DEVICE_UNLINK: "Tablet desvinculado",
  DEVICE_KIOSK_EXIT: "Saiu do modo quiosque",
  SESSION_REVOKE: "Sessão encerrada",
  SESSION_REUSE_DETECTED: "Reuso de credencial detectado",
  STORE_CREATE: "Loja cadastrada",
  STORE_UPDATE: "Loja alterada",
  STORE_DEACTIVATE: "Loja desativada",
  DATA_EXPORT: "Documento acessado",
  TIMECLOCK_ENTRY_CREATE: "Ponto registrado",
  TIMECLOCK_CORRECTION: "Ponto corrigido",
  WORK_SCHEDULE_CREATE: "Jornada cadastrada",
  TWO_FACTOR_ENABLE: "Verificação em duas etapas ativada",
  TWO_FACTOR_CHALLENGE_FAILED: "Código de verificação incorreto",
  STEP_UP_ISSUED: "Identidade confirmada",
  STEP_UP_FAILED: "Confirmação de identidade recusada",
  SETTING_UPDATE: "Configuração alterada",
};

const RESULT_LABELS: Record<string, string> = {
  SUCCESS: "Concluído",
  FAILURE: "Falhou",
  DENIED: "Negado",
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

export function AuditPage() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [onlyProblems, setOnlyProblems] = useState(false);

  const audit = useQuery({
    queryKey: ["audit", cursor, onlyProblems],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      if (onlyProblems) params.set("result", "DENIED");
      return apiFetch<{ entries: AuditEntry[]; nextCursor: string | null }>(
        `/api/v1/audit?${params.toString()}`,
      );
    },
  });

  return (
    <PageShell
      title="Auditoria"
      description="Registro do que aconteceu no sistema. Não pode ser alterado nem apagado — nem por você."
    >
      <div className="mb-5 flex flex-wrap gap-2">
        <Button
          type="button"
          variant={onlyProblems ? "outline" : "secondary"}
          onClick={() => {
            setOnlyProblems(false);
            setCursor(undefined);
          }}
        >
          Tudo
        </Button>
        <Button
          type="button"
          variant={onlyProblems ? "secondary" : "outline"}
          onClick={() => {
            setOnlyProblems(true);
            setCursor(undefined);
          }}
        >
          Só acessos negados
        </Button>
      </div>

      {audit.data?.entries.length === 0 && <Alert tone="info">Nenhum registro no filtro atual.</Alert>}

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background-secondary">
            <tr>
              <th className="px-4 py-3 font-semibold">Quando</th>
              <th className="px-4 py-3 font-semibold">Quem</th>
              <th className="px-4 py-3 font-semibold">O que</th>
              <th className="px-4 py-3 font-semibold">Resultado</th>
              <th className="px-4 py-3 font-semibold">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {audit.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                  Carregando...
                </td>
              </tr>
            )}

            {audit.data?.entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-text-secondary">
                  {formatDateTime(entry.createdAt)}
                </td>
                <td className="px-4 py-3">
                  {entry.user ? (
                    <>
                      <span className="font-medium">{entry.user.name}</span>
                      <span className="block text-text-muted">{entry.user.employeeCode}</span>
                    </>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      entry.result === "SUCCESS"
                        ? "text-success"
                        : entry.result === "DENIED"
                          ? "text-danger"
                          : "text-warning"
                    }
                  >
                    {RESULT_LABELS[entry.result] ?? entry.result}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-secondary">{entry.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {audit.data?.nextCursor && (
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => setCursor(audit.data.nextCursor ?? undefined)}
        >
          Carregar mais
        </Button>
      )}
    </PageShell>
  );
}
