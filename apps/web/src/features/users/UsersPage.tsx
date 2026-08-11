import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, UserPlus } from "lucide-react";
import type { UserRole, UserSummary } from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
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
  const [role, setRole] = useState<UserRole>("VENDEDOR");
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offDeviceTarget, setOffDeviceTarget] = useState<UserRow | null>(null);

  /** Credencial recém-gerada. Existe só nesta tela, e só até fechar. */
  const [credential, setCredential] = useState<{
    name: string;
    code: string;
    password: string;
  } | null>(null);

  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserRow[]>("/api/v1/users"),
  });

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<Store[]>("/api/v1/stores"),
  });

  function handleError(caught: unknown, fallback: string) {
    setError(caught instanceof ApiError ? caught.message : fallback);
  }

  const createUser = useMutation({
    mutationFn: () =>
      apiFetch<{ user: { name: string; employeeCode: string }; temporaryPassword: string }>(
        "/api/v1/users",
        { method: "POST", body: { name, role, storeIds } },
      ),
    onSuccess: (result) => {
      setCredential({
        name: result.user.name,
        code: result.user.employeeCode,
        password: result.temporaryPassword,
      });
      setError(null);
      setShowForm(false);
      setName("");
      setStoreIds([]);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (caught) => handleError(caught, "Não foi possível cadastrar agora."),
  });

  const regenerate = useMutation({
    mutationFn: (target: UserRow) =>
      apiFetch<{ employeeCode: string; temporaryPassword: string }>(
        `/api/v1/users/${target.id}/regenerate-password`,
        { method: "POST" },
      ).then((result) => ({ ...result, name: target.name })),
    onSuccess: (result) =>
      setCredential({
        name: result.name,
        code: result.employeeCode,
        password: result.temporaryPassword,
      }),
    onError: (caught) => handleError(caught, "Não foi possível gerar a senha."),
  });

  return (
    <PageShell
      title="Funcionários"
      description="A matrícula e a senha são geradas pelo sistema e entregues por você."
      actions={
        isOwner && (
          <Button onClick={() => setShowForm((current) => !current)}>
            <UserPlus className="h-5 w-5" aria-hidden />
            Novo funcionário
          </Button>
        )
      }
    >
      {/*
        A credencial aparece uma única vez. Não fica guardada em lugar nenhum —
        se o dono fechar sem anotar, o caminho é gerar outra, que invalida esta.
      */}
      {credential && (
        <div className="mb-6">
          <Alert tone="success" title={`Credencial de ${credential.name}`}>
            <p>Anote e entregue em mãos. Esta senha não aparece de novo.</p>

            <dl className="mt-3 grid gap-2 rounded-md bg-surface p-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-text-secondary">Matrícula</dt>
                <dd className="font-mono text-lg">{credential.code}</dd>
              </div>
              <div>
                <dt className="text-sm text-text-secondary">Senha temporária</dt>
                <dd className="font-mono text-lg">{credential.password}</dd>
              </div>
            </dl>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `Matrícula: ${credential.code}\nSenha temporária: ${credential.password}`,
                  )
                }
              >
                <Copy className="h-5 w-5" aria-hidden />
                Copiar
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCredential(null)}>
                Já anotei
              </Button>
            </div>
          </Alert>
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
              {createUser.isPending ? "Cadastrando..." : "Cadastrar"}
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
                <td className="px-4 py-3 font-medium">{entry.name}</td>
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
                          onClick={() => regenerate.mutate(entry)}
                          disabled={regenerate.isPending}
                        >
                          <KeyRound className="h-4 w-4" aria-hidden />
                          Nova senha
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

      {offDeviceTarget && (
        <OffDeviceAccessDialog
          user={offDeviceTarget}
          currentlyAllowed={offDeviceTarget.offDeviceAllowed}
          onClose={() => setOffDeviceTarget(null)}
        />
      )}
    </PageShell>
  );
}
