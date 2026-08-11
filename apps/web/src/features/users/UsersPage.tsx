import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import type { UserRole, UserSummary } from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "../auth/auth-context";
import { OffDeviceAccessDialog } from "./OffDeviceAccessDialog";

interface Store {
  id: string;
  code: string;
  name: string;
}

/** O que a listagem devolve, além do resumo compartilhado. */
type UserRow = UserSummary & {
  offDeviceAllowed: boolean;
  offDeviceExpiresAt: string | null;
};

const ROLE_LABELS: Record<UserRole, string> = {
  VENDEDOR: "Vendedor",
  GERENTE: "Gerente",
  DONO: "Dono",
  DESENVOLVEDOR: "Desenvolvedor",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_FIRST_ACCESS: "Aguardando primeiro acesso",
  ACTIVE: "Ativo",
  BLOCKED: "Bloqueado",
  INACTIVE: "Inativo",
};

export function UsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = user?.role === "DONO";

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("VENDEDOR");
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [offDeviceTarget, setOffDeviceTarget] = useState<UserRow | null>(null);

  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserRow[]>("/api/v1/users"),
  });

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<Store[]>("/api/v1/stores"),
  });

  const createUser = useMutation({
    mutationFn: () =>
      apiFetch<{ user: { employeeCode: string }; welcomeEmailDelivered: boolean }>(
        "/api/v1/users",
        { method: "POST", body: { name, email, role, storeIds } },
      ),
    onSuccess: (result) => {
      setFeedback(
        result.welcomeEmailDelivered
          ? `Funcionário cadastrado. A matrícula ${result.user.employeeCode} e a senha temporária foram enviadas para ${email}.`
          : `Funcionário cadastrado com a matrícula ${result.user.employeeCode}, mas o e-mail não pôde ser enviado. Use "Reenviar credenciais".`,
      );
      setError(null);
      setShowForm(false);
      setName("");
      setEmail("");
      setStoreIds([]);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiError ? caught.message : "Não foi possível cadastrar agora.",
      );
    },
  });

  const resend = useMutation({
    mutationFn: (userId: string) =>
      apiFetch(`/api/v1/users/${userId}/resend-credentials`, { method: "POST" }),
    onSuccess: () => setFeedback("Novas credenciais enviadas. A senha anterior deixou de valer."),
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível reenviar."),
  });

  return (
    <main className="min-h-screen bg-background-secondary px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Funcionários</h1>
            <p className="text-text-secondary">
              A matrícula e a senha são geradas pelo sistema e enviadas por e-mail.
            </p>
          </div>

          {isOwner && (
            <Button onClick={() => setShowForm((current) => !current)}>
              <UserPlus className="h-5 w-5" aria-hidden />
              Novo funcionário
            </Button>
          )}
        </header>

        {feedback && (
          <div className="mb-5">
            <Alert tone="success">{feedback}</Alert>
          </div>
        )}
        {error && (
          <div className="mb-5">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        {showForm && isOwner && (
          <form
            className="mb-6 flex flex-col gap-5 rounded-lg border border-border bg-surface p-6"
            onSubmit={(event) => {
              event.preventDefault();
              createUser.mutate();
            }}
          >
            <Field
              label="Nome completo"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <Field
              label="E-mail"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              hint="É para cá que vão a matrícula e a senha temporária."
              required
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="role" className="text-sm font-medium text-text-secondary">
                Perfil
              </label>
              <select
                id="role"
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                className="min-h-[48px] rounded-md border border-border bg-surface px-4 text-base"
              >
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text-secondary">Lojas</legend>
              {stores.data?.map((store) => (
                <label key={store.id} className="flex min-h-[44px] items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-rose-primary"
                    checked={storeIds.includes(store.id)}
                    onChange={(event) =>
                      setStoreIds((current) =>
                        event.target.checked
                          ? [...current, store.id]
                          : current.filter((id) => id !== store.id),
                      )
                    }
                  />
                  <span>
                    {store.name} <span className="text-text-muted">({store.code})</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex gap-3">
              <Button type="submit" disabled={createUser.isPending}>
                {createUser.isPending ? "Cadastrando..." : "Cadastrar e enviar acesso"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-background-secondary">
              <tr>
                <th className="px-4 py-3 font-semibold">Nome</th>
                <th className="px-4 py-3 font-semibold">Matrícula</th>
                <th className="px-4 py-3 font-semibold">Perfil</th>
                <th className="px-4 py-3 font-semibold">Situação</th>
                <th className="px-4 py-3 font-semibold">Onde pode entrar</th>
                {isOwner && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {users.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                    Carregando...
                  </td>
                </tr>
              )}

              {users.data?.map((entry) => (
                <tr key={entry.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{entry.name}</div>
                    <div className="text-text-muted">{entry.email}</div>
                  </td>
                  <td className="px-4 py-3 font-mono">{entry.employeeCode}</td>
                  <td className="px-4 py-3">{ROLE_LABELS[entry.role]}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        entry.status === "ACTIVE"
                          ? "text-success"
                          : entry.status === "BLOCKED"
                            ? "text-danger"
                            : "text-warning"
                      }
                    >
                      {STATUS_LABELS[entry.status] ?? entry.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {entry.role === "DONO" || entry.role === "DESENVOLVEDOR" ? (
                      <span className="text-text-muted">Qualquer aparelho</span>
                    ) : entry.offDeviceAllowed ? (
                      <span className="text-info">
                        Liberado
                        {entry.offDeviceExpiresAt && (
                          <span className="block text-text-muted">
                            até {new Date(entry.offDeviceExpiresAt).toLocaleDateString("pt-BR")}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-text-secondary">Somente tablet</span>
                    )}
                  </td>

                  {isOwner && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {entry.status === "PENDING_FIRST_ACCESS" && (
                          <Button
                            variant="outline"
                            onClick={() => resend.mutate(entry.id)}
                            disabled={resend.isPending}
                          >
                            Reenviar credenciais
                          </Button>
                        )}

                        {entry.role !== "DONO" && entry.role !== "DESENVOLVEDOR" && (
                          <Button
                            variant={entry.offDeviceAllowed ? "ghost" : "outline"}
                            onClick={() => setOffDeviceTarget(entry)}
                          >
                            {entry.offDeviceAllowed ? "Cortar acesso externo" : "Liberar fora da loja"}
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {offDeviceTarget && (
        <OffDeviceAccessDialog
          user={offDeviceTarget}
          currentlyAllowed={offDeviceTarget.offDeviceAllowed}
          onClose={() => setOffDeviceTarget(null)}
        />
      )}
    </main>
  );
}
