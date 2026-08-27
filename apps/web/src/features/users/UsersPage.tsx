import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Copy, KeyRound, Pencil, UserMinus, UserPlus } from "lucide-react";
import type { UserRole, UserSummary } from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { PinResetRequests } from "@/features/auth/PinResetRequests";
import { apiFetch, ApiError, requestStepUpToken } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
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

/**
 * Perfis que a loja atribui.
 *
 * O suporte tecnico fica de fora: nao e um cargo da joalheria, e uma conta de
 * manutencao do sistema. Oferece-lo aqui criaria uma conta que o dono depois
 * nao encontra na lista — porque ela e escondida de proposito.
 */
const PERFIS_ATRIBUIVEIS: UserRole[] = ["VENDEDOR", "GERENTE", "DONO"];

const STATUS_LABELS: Record<string, string> = {
  PENDING_FIRST_ACCESS: "Aguardando primeiro acesso",
  ACTIVE: "Ativo",
  BLOCKED: "Bloqueado",
  INACTIVE: "Inativo",
};

export function UsersPage() {
  const confirmar = useConfirm();
  const [avisoDesligamento, setAvisoDesligamento] = useState<string | null>(null);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = user?.role === "DONO";

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [role, setRole] = useState<UserRole>("VENDEDOR");
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offDeviceTarget, setOffDeviceTarget] = useState<UserRow | null>(null);

  /** Funcionário aberto para edição de cadastro. */
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    cpf: "",
    storeIds: [] as string[],
  });
  const [novoPerfil, setNovoPerfil] = useState<UserRow["role"] | "">("");
  const [motivoPerfil, setMotivoPerfil] = useState("");
  /**
   * Reconfirmação de quem está mudando o perfil.
   *
   * Quem tem 2FA confirmado reautentica pelo código do autenticador — é o que
   * prova posse da conta, não só conhecimento da senha. Quem não tem, pela
   * senha. O dono sempre tem 2FA, então na prática cai no código.
   */
  const [senhaConfirmacao, setSenhaConfirmacao] = useState("");
  const [codigoConfirmacao, setCodigoConfirmacao] = useState("");
  const usaAutenticador = user?.role === "DONO";

  /** Credencial recém-gerada. Existe só nesta tela, e só até fechar. */
  const [credential, setCredential] = useState<{
    name: string;
    code: string;
    password: string;
    /** O que a pessoa vai usar no tablet — a senha é só para o computador. */
    pin: string;
    emailSent: boolean;
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
      apiFetch<{
        user: { name: string; employeeCode: string };
        temporaryPassword: string;
        temporaryPin: string;
        emailSent: boolean;
      }>("/api/v1/users", {
        method: "POST",
        // E-mail em branco não vai como string vazia: o campo é opcional.
        body: {
          name,
          role,
          storeIds,
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(cpf.trim() ? { cpf: cpf.trim() } : {}),
        },
      }),
    onSuccess: (result) => {
      setCredential({
        name: result.user.name,
        code: result.user.employeeCode,
        password: result.temporaryPassword,
        pin: result.temporaryPin,
        emailSent: result.emailSent,
      });
      setError(null);
      setShowForm(false);
      setName("");
      setEmail("");
      setStoreIds([]);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (caught) => handleError(caught, "Não foi possível cadastrar agora."),
  });

  const salvarCadastro = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/users/${editing?.id}`, {
        method: "PATCH",
        body: {
          name: editForm.name.trim(),
          // String vazia apaga o e-mail; `undefined` deixaria como está.
          email: editForm.email.trim(),
          cpf: editForm.cpf.trim(),
          storeIds: editForm.storeIds,
        },
      }),
    onSuccess: () => {
      setError(null);
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (caught) => handleError(caught, "Não foi possível salvar o cadastro."),
  });

  /**
   * Trocar o perfil derruba as sessões abertas da pessoa — o perfil viaja
   * dentro do token, e sem isso um rebaixamento demoraria até 15 minutos para
   * valer. Por isso exige motivo: é ato que interrompe alguém no meio do
   * expediente.
   */
  const trocarPerfil = useMutation({
    mutationFn: async () => {
      // Promover a dono é a ação mais perigosa do sistema; as demais trocas
      // mexem em permissão. As duas exigem a senha de novo — um tablet
      // destravado no balcão não pode virar promoção a dono.
      const stepUpToken = await requestStepUpToken({
        purpose: novoPerfil === "DONO" ? "CREATE_OR_PROMOTE_OWNER" : "CHANGE_PERMISSIONS",
        ...(usaAutenticador
          ? { totpCode: codigoConfirmacao }
          : { password: senhaConfirmacao }),
      });

      return apiFetch(`/api/v1/users/${editing?.id}/role`, {
        method: "PATCH",
        body: { role: novoPerfil, reason: motivoPerfil },
        stepUpToken,
      });
    },
    onSuccess: () => {
      setError(null);
      setNovoPerfil("");
      setMotivoPerfil("");
      setSenhaConfirmacao("");
      setCodigoConfirmacao("");
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (caught) => handleError(caught, "Não foi possível trocar o perfil."),
  });

  const bloquear = useMutation({
    mutationFn: (params: { id: string; bloquear: boolean; reason: string }) =>
      apiFetch(`/api/v1/users/${params.id}/${params.bloquear ? "block" : "unblock"}`, {
        method: "POST",
        body: { reason: params.reason },
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (caught) => handleError(caught, "Não foi possível concluir."),
  });

  /**
   * Remover.
   *
   * A mesma regra do resto do sistema: quem já foi usado por algo que virou
   * histórico é desativado; quem nunca encostou em nada some de vez.
   *
   * Para funcionário, "histórico" não é escolha de projeto — é ponto, venda e
   * caixa, que a lei e a contabilidade mandam guardar depois da saída. Uma
   * conta criada por engano, ou de demonstração, não tem nada disso e não
   * deveria ficar para sempre numa lista de inativos.
   *
   * Quem decide é o servidor, que é quem sabe o que existe. A resposta diz
   * qual dos dois caminhos foi tomado, e por quê.
   */
  const desligar = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      apiFetch<{ mensagem: string }>(`/api/v1/users/${params.id}`, {
        method: "DELETE",
        body: { reason: params.reason },
      }),
    onSuccess: (resultado) => {
      setError(null);
      setAvisoDesligamento(resultado.mensagem);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (caught) => handleError(caught, "Não foi possível desligar."),
  });

  const regenerate = useMutation({
    mutationFn: (target: UserRow) =>
      apiFetch<{
        employeeCode: string;
        temporaryPassword: string;
        temporaryPin: string;
        emailSent: boolean;
      }>(`/api/v1/users/${target.id}/regenerate-password`, { method: "POST" }).then((result) => ({
        ...result,
        name: target.name,
      })),
    onSuccess: (result) =>
      setCredential({
        name: result.name,
        code: result.employeeCode,
        password: result.temporaryPassword,
        pin: result.temporaryPin,
        emailSent: result.emailSent,
      }),
    onError: (caught) => handleError(caught, "Não foi possível gerar as credenciais."),
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
      {/* Quem esqueceu o PIN está esperando agora — por isso vem antes de tudo. */}
      {avisoDesligamento && (
        <div className="mb-5">
          <Alert tone="success">{avisoDesligamento}</Alert>
        </div>
      )}

      <PinResetRequests />

      {/*
        A credencial aparece uma única vez. Não fica guardada em lugar nenhum —
        se o dono fechar sem anotar, o caminho é gerar outra, que invalida esta.
      */}
      {credential && (
        <div className="mb-6">
          <Alert tone="success" title={`Credencial de ${credential.name}`}>
            <p>
              {credential.emailSent
                ? "Enviada também para o e-mail cadastrado. Anote mesmo assim — não aparece de novo aqui."
                : "Anote e entregue em mãos. Não aparece de novo."}
            </p>

            <dl className="mt-3 grid gap-2 rounded-md bg-surface p-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-text-secondary">Matrícula</dt>
                <dd className="font-mono text-lg">{credential.code}</dd>
              </div>
              <div>
                <dt className="text-sm text-text-secondary">PIN de entrada (tablet)</dt>
                <dd className="font-mono text-lg tracking-widest">{credential.pin}</dd>
              </div>
              <div>
                <dt className="text-sm text-text-secondary">Senha (computador)</dt>
                <dd className="font-mono text-lg">{credential.password}</dd>
              </div>
            </dl>

            <p className="mt-3 text-sm">
              No balcão, o que vale é a matrícula e o PIN. Na primeira entrada o sistema já pede
              que a pessoa escolha o PIN dela.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `Matrícula: ${credential.code}\nPIN de entrada: ${credential.pin}\nSenha (computador): ${credential.password}`,
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

          <Field
            label="E-mail (opcional)"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            hint="Só para receber a credencial e avisos. Não serve para entrar no sistema — o login é sempre pela matrícula."
          />

          <Field
            label="CPF (opcional)"
            value={cpf}
            onChange={(event) => setCpf(event.target.value)}
            placeholder="000.000.000-00"
            hint="Sem CPF o funcionário não entra no arquivo do ponto (AFD) exigido pela fiscalização."
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
              {PERFIS_ATRIBUIVEIS.map((option) => (
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

      {editing && (
        <div className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-soft">
          <h2 className="mb-1 font-medium text-text-primary">Editar {editing.name}</h2>
          <p className="mb-4 text-sm text-text-secondary">
            Matrícula {editing.employeeCode} — a matrícula nunca muda, é a identidade da pessoa
            no sistema.
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              salvarCadastro.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Nome completo"
                required
                value={editForm.name}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
              />
              <Field
                label="E-mail"
                type="email"
                value={editForm.email}
                onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                hint="Canal de entrega de credencial e avisos. Não serve para entrar."
              />
              <Field
                label="CPF"
                value={editForm.cpf}
                onChange={(event) => setEditForm({ ...editForm, cpf: event.target.value })}
                placeholder="000.000.000-00"
                hint="Necessário para o funcionário aparecer no AFD, o arquivo do ponto."
              />
            </div>

            <fieldset className="mt-5 flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-text-secondary">Lojas</legend>
              {stores.data?.map((store) => (
                <label key={store.id} className="flex min-h-[44px] items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-rose-primary"
                    checked={editForm.storeIds.includes(store.id)}
                    onChange={(event) =>
                      setEditForm({
                        ...editForm,
                        storeIds: event.target.checked
                          ? [...editForm.storeIds, store.id]
                          : editForm.storeIds.filter((id) => id !== store.id),
                      })
                    }
                  />
                  <span>
                    {store.name} <span className="text-text-muted">({store.code})</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="mt-5 flex gap-3">
              <Button type="submit" disabled={salvarCadastro.isPending}>
                Salvar cadastro
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            </div>
          </form>

          {/*
            Trocar o perfil fica separado do resto: é o único campo aqui que
            muda o que a pessoa PODE FAZER, derruba as sessões abertas dela e
            exige motivo. Misturar com "corrigir o nome" convidaria a mexer
            sem perceber.
          */}
          {editing.id !== user?.id && (
            <div className="mt-6 border-t border-border/70 pt-5">
              <h3 className="mb-1 text-sm font-medium text-text-primary">Perfil de acesso</h3>
              <p className="mb-3 text-sm text-text-secondary">
                Hoje: <strong>{ROLE_LABELS[editing.role]}</strong>. Trocar desconecta a pessoa
                na hora — o perfil viaja dentro da sessão.
              </p>

              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem]">
                  <label
                    className="mb-1 block text-sm font-medium text-text-secondary"
                    htmlFor="novo-perfil"
                  >
                    Novo perfil
                  </label>
                  <select
                    id="novo-perfil"
                    value={novoPerfil}
                    onChange={(event) => setNovoPerfil(event.target.value as UserRole)}
                    className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3"
                  >
                    <option value="">Manter como está</option>
                    {PERFIS_ATRIBUIVEIS
                      .filter((option) => option !== editing.role)
                      .map((option) => (
                        <option key={option} value={option}>
                          {ROLE_LABELS[option]}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="min-w-[14rem] flex-1">
                  <Field
                    label="Motivo da troca"
                    value={motivoPerfil}
                    onChange={(event) => setMotivoPerfil(event.target.value)}
                    hint="Fica na auditoria."
                  />
                </div>

                <div className="min-w-[12rem]">
                  {usaAutenticador ? (
                    <Field
                      label="Código do autenticador"
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="one-time-code"
                      value={codigoConfirmacao}
                      onChange={(event) =>
                        setCodigoConfirmacao(event.target.value.replace(/\D/g, ""))
                      }
                      hint="Os 6 números do seu aplicativo."
                    />
                  ) : (
                    <Field
                      label="Sua senha"
                      type="password"
                      autoComplete="current-password"
                      value={senhaConfirmacao}
                      onChange={(event) => setSenhaConfirmacao(event.target.value)}
                      hint="Confirmação de quem está mudando."
                    />
                  )}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !novoPerfil ||
                    motivoPerfil.trim().length < 3 ||
                    (usaAutenticador
                      ? codigoConfirmacao.length !== 6
                      : senhaConfirmacao.length === 0) ||
                    trocarPerfil.isPending
                  }
                  onClick={() => trocarPerfil.mutate()}
                >
                  Trocar perfil
                </Button>
              </div>
            </div>
          )}
        </div>
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

                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditing(entry);
                          setEditForm({
                            name: entry.name,
                            email: entry.email ?? "",
                            cpf: entry.cpf ?? "",
                            storeIds: entry.storeIds,
                          });
                          setNovoPerfil("");
                          setMotivoPerfil("");
                        }}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                        Editar
                      </Button>

                      {entry.status !== "PENDING_FIRST_ACCESS" && (
                        <Button
                          variant="ghost"
                          disabled={bloquear.isPending}
                          onClick={async () => {
                            const bloqueando = entry.status !== "BLOCKED";
                            const motivo = await confirmar({
                              titulo: bloqueando
                                ? `Bloquear ${entry.name}?`
                                : `Desbloquear ${entry.name}?`,
                              descricao: bloqueando
                                ? "A pessoa deixa de entrar no sistema, no tablet e no computador. As vendas dela continuam no histórico."
                                : "A pessoa volta a entrar com a matrícula e o PIN de sempre.",
                              acao: bloqueando ? "Bloquear" : "Desbloquear",
                              destrutivo: bloqueando,
                              pedirMotivo: true,
                            });

                            if (motivo !== null) {
                              bloquear.mutate({
                                id: entry.id,
                                bloquear: bloqueando,
                                reason: motivo,
                              });
                            }
                          }}
                        >
                          {entry.status === "BLOCKED" ? (
                            <>
                              <CheckCircle2 className="h-4 w-4" aria-hidden />
                              Desbloquear
                            </>
                          ) : (
                            <>
                              <Ban className="h-4 w-4" aria-hidden />
                              Bloquear
                            </>
                          )}
                        </Button>
                      )}

                      {entry.id !== user?.id && (
                        <Button
                          variant="ghost"
                          disabled={desligar.isPending}
                          onClick={async () => {
                            const motivo = await confirmar({
                              titulo: `Remover ${entry.name}?`,
                              descricao:
                                "O acesso acaba agora e a pessoa sai da lista. Quem nunca registrou ponto, venda nem caixa é APAGADO de vez; quem já trabalhou fica guardado no histórico, porque o ponto tem valor legal depois da saída. O sistema decide pelo que encontrar e diz o que fez.",
                              acao: "Remover",
                              destrutivo: true,
                              pedirMotivo: true,
                            });

                            if (motivo !== null) {
                              desligar.mutate({ id: entry.id, reason: motivo });
                            }
                          }}
                        >
                          <UserMinus className="h-4 w-4" aria-hidden />
                          Remover
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
