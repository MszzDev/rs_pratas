import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";

type TerminalStatus = "PENDING" | "ACTIVE" | "BLOCKED" | "RETIRED";

interface Terminal {
  id: string;
  provider: string | null;
  serialNumber: string | null;
  status: TerminalStatus;
  isPrimary: boolean;
  storeId: string;
  deviceId: string;
  device: { name: string; status: string };
  /**
   * Conta do Mercado Pago desta maquininha. O token nunca vem — só o fim dele.
   *
   * Opcional porque o site e a API sobem em serviços separados: por alguns
   * minutos a tela nova pode estar conversando com a API antiga, e uma tela em
   * branco no meio do expediente é pior que um campo a menos.
   */
  conta?: {
    configurada: boolean;
    apelido: string | null;
    contaId: string | null;
    tokenPreview: string | null;
    atualizadoEm: string | null;
  };
  /**
   * Recebe o valor da venda direto do PDV.
   *
   * Exige as duas coisas: a conta e o aparelho escolhido entre as maquininhas
   * dela. Só uma não cobra nada.
   */
  aceitaCobranca?: boolean;
}

interface DeviceRow {
  id: string;
  name: string;
  storeId: string;
  status: string;
}

const STATUS_LABELS: Record<TerminalStatus, string> = {
  PENDING: "Aguardando primeiro uso",
  ACTIVE: "Em uso",
  BLOCKED: "Bloqueada",
  RETIRED: "Substituída",
};

const STATUS_STYLES: Record<TerminalStatus, string> = {
  PENDING: "bg-warning/10 text-warning",
  ACTIVE: "bg-success/10 text-success",
  BLOCKED: "bg-danger/10 text-danger",
  RETIRED: "bg-border text-text-muted",
};

export function TerminalsPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ deviceId: "", provider: "", serialNumber: "" });
  const [aviso, setAviso] = useState<string | null>(null);
  /** Maquininha cuja conta está sendo informada agora. */
  const [configurando, setConfigurando] = useState<string | null>(null);
  const [conta, setConta] = useState({ accessToken: "", label: "" });
  /** Aparelhos Point encontrados na conta, para o dono dizer qual é este. */
  const [aparelhos, setAparelhos] = useState<{
    terminalId: string;
    lista: Array<{ id: string; modo: string | null; escolhido: boolean }>;
  } | null>(null);

  const terminals = useQuery({
    queryKey: ["terminals"],
    queryFn: () => apiFetch<Terminal[]>("/api/v1/terminals"),
  });

  const devices = useQuery({
    queryKey: ["devices"],
    queryFn: () => apiFetch<DeviceRow[]>("/api/v1/devices"),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["terminals"] });
  };

  const handleError = (caught: unknown) =>
    setError(caught instanceof ApiError ? caught.message : "Não foi possível concluir.");

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/terminals", {
        method: "POST",
        body: {
          deviceId: form.deviceId,
          ...(form.provider ? { provider: form.provider } : {}),
          ...(form.serialNumber ? { serialNumber: form.serialNumber } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setAdding(false);
      setForm({ deviceId: "", provider: "", serialNumber: "" });
      invalidate();
    },
    onError: handleError,
  });

  const salvarConta = useMutation({
    mutationFn: (params: { id: string; accessToken: string; label: string }) =>
      apiFetch<{ aviso: string }>(`/api/v1/terminals/${params.id}/mercadopago`, {
        method: "PUT",
        body: {
          accessToken: params.accessToken.trim(),
          ...(params.label.trim() ? { label: params.label.trim() } : {}),
        },
      }),
    onSuccess: (resultado) => {
      setError(null);
      setAviso(resultado.aviso);
      setConfigurando(null);
      invalidate();
    },
    onError: handleError,
  });

  /**
   * As maquininhas Point que existem na conta.
   *
   * O número de série impresso no aparelho não é o identificador que a API
   * usa — por isso a lista vem do Mercado Pago e o dono escolhe qual é esta.
   */
  const procurarAparelhos = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Array<{ id: string; modo: string | null; escolhido: boolean }>>(
        `/api/v1/terminals/${id}/point-devices`,
      ).then((lista) => ({ terminalId: id, lista })),
    onSuccess: (resultado) => {
      setError(null);
      setAparelhos(resultado);

      if (resultado.lista.length === 0) {
        setAviso("Esta conta não tem nenhuma maquininha Point ligada e conectada à internet.");
      }
    },
    onError: handleError,
  });

  const escolherAparelho = useMutation({
    mutationFn: (params: { terminalId: string; pointDeviceId: string }) =>
      apiFetch(`/api/v1/terminals/${params.terminalId}/point-device`, {
        method: "PUT",
        body: { pointDeviceId: params.pointDeviceId },
      }),
    onSuccess: () => {
      setError(null);
      setAviso("Pronto. Agora o valor da venda vai direto para a tela desta maquininha.");
      setAparelhos(null);
      invalidate();
    },
    onError: handleError,
  });

  const removerConta = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/terminals/${id}/mercadopago`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      setAviso("Conta removida. A maquininha continua cobrando normalmente.");
      invalidate();
    },
    onError: handleError,
  });

  const makePrimary = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/terminals/${id}/primary`, { method: "POST" }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const changeStatus = useMutation({
    mutationFn: (params: { id: string; status: "ACTIVE" | "BLOCKED"; reason: string }) =>
      apiFetch(`/api/v1/terminals/${params.id}/status`, {
        method: "PATCH",
        body: { status: params.status, reason: params.reason },
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const remove = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      apiFetch<{ mensagem: string }>(`/api/v1/terminals/${params.id}`, {
        method: "DELETE",
        body: { reason: params.reason },
      }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  // Só tablets já pareados: uma maquininha precisa nascer amarrada a um caixa
  // que existe de verdade.
  const pairedDevices = (devices.data ?? []).filter((device) => device.status === "ACTIVE");

  return (
    <PageShell
      title="Maquininhas"
      description="Cada maquininha pertence a um tablet, e por ele a um caixa e a uma loja."
      actions={
        adding ? null : (
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus className="h-5 w-5" aria-hidden />
            Cadastrar maquininha
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {aviso && (
        <div className="mb-5">
          <Alert tone="success">{aviso}</Alert>
        </div>
      )}

      {adding && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="tablet">
                Tablet
              </label>
              <select
                id="tablet"
                required
                value={form.deviceId}
                onChange={(event) => setForm({ ...form, deviceId: event.target.value })}
                className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
              >
                <option value="">Selecione</option>
                {pairedDevices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Operadora"
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
              hint="Ex.: Mercado Pago, Rede."
            />
            <Field
              label="Número de série"
              value={form.serialNumber}
              onChange={(event) => setForm({ ...form, serialNumber: event.target.value })}
              hint="Está impresso atrás do aparelho."
            />
          </div>

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={create.isPending}>
              Cadastrar
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>

          {pairedDevices.length === 0 && (
            <p className="mt-4 text-sm text-text-secondary">
              Nenhum tablet pareado ainda. Pareie um tablet antes de cadastrar a maquininha.
            </p>
          )}
        </form>
      )}

      <ul className="space-y-3">
        {terminals.data?.map((terminal) => (
          <li
            key={terminal.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5"
          >
            <div className="flex items-start gap-3">
              <CreditCard className="mt-1 h-5 w-5 text-text-secondary" aria-hidden />
              <div>
                <p className="font-medium text-text-primary">
                  {terminal.provider ?? "Maquininha"}
                  {terminal.serialNumber ? ` · ${terminal.serialNumber}` : ""}
                </p>
                <p className="text-sm text-text-secondary">No tablet {terminal.device.name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-sm ${STATUS_STYLES[terminal.status]}`}
                  >
                    {STATUS_LABELS[terminal.status]}
                  </span>
                  {terminal.isPrimary && (
                    <span className="inline-block rounded bg-rose-soft px-2 py-0.5 text-sm text-rose-dark">
                      Principal do caixa
                    </span>
                  )}
                </div>

                {/*
                  Cada maquininha está numa conta do Mercado Pago diferente —
                  foi assim que a loja contratou. Dizer QUAL conta é esta, aqui
                  do lado do número de série, é o que evita colar o token de um
                  aparelho no outro.
                */}
                <p className="mt-2 text-sm text-text-muted">
                  {terminal.conta?.configurada ? (
                    <>
                      Conta <strong className="text-text-secondary">{terminal.conta?.apelido}</strong>{" "}
                      · token {terminal.conta?.tokenPreview}
                    </>
                  ) : (
                    "Sem conta do Mercado Pago — cobra normalmente, mas o sistema não consulta nem estorna."
                  )}
                </p>

                {terminal.conta?.configurada && (
                  <p className="mt-1 text-sm">
                    {terminal.aceitaCobranca ? (
                      <span className="text-sage-dark">
                        O valor da venda vai direto para a tela dela.
                      </span>
                    ) : (
                      <span className="text-text-muted">
                        O valor ainda é digitado no aparelho — falta dizer qual maquininha da conta
                        é esta.
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConfigurando(configurando === terminal.id ? null : terminal.id);
                  setConta({ accessToken: "", label: terminal.conta?.apelido ?? "" });
                }}
              >
                {terminal.conta?.configurada ? "Trocar conta" : "Informar conta"}
              </Button>

              {terminal.conta?.configurada && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={procurarAparelhos.isPending}
                  onClick={() => procurarAparelhos.mutate(terminal.id)}
                >
                  {procurarAparelhos.isPending
                    ? "Procurando..."
                    : terminal.aceitaCobranca
                      ? "Trocar aparelho"
                      : "Ligar ao aparelho"}
                </Button>
              )}

              {terminal.status === "ACTIVE" && !terminal.isPrimary && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={makePrimary.isPending}
                  onClick={() => makePrimary.mutate(terminal.id)}
                >
                  Tornar principal
                </Button>
              )}

              {terminal.status !== "RETIRED" && (
              <Button
                type="button"
                variant="outline"
                disabled={changeStatus.isPending}
                onClick={() =>
                  changeStatus.mutate({
                    id: terminal.id,
                    status: terminal.status === "ACTIVE" ? "BLOCKED" : "ACTIVE",
                    reason:
                      terminal.status === "ACTIVE"
                        ? "bloqueada pelo responsável"
                        : "liberada pelo responsável",
                  })
                }
              >
                {terminal.status === "ACTIVE" ? "Bloquear" : "Liberar"}
              </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => {
                  const reason = window.prompt("Remover esta maquininha. Por quê?");
                  if (reason && reason.trim().length >= 3) {
                    remove.mutate({ id: terminal.id, reason: reason.trim() });
                  }
                }}
              >
                <Trash2 className="h-5 w-5" aria-hidden />
                Remover
              </Button>
            </div>

            {aparelhos?.terminalId === terminal.id && aparelhos.lista.length > 0 && (
              <div className="w-full border-t border-border/70 pt-4">
                <p className="mb-3 text-sm text-text-secondary">
                  Estas são as maquininhas ligadas nesta conta agora. Qual delas é esta? (Se
                  estiver em dúvida, o aparelho mostra o número dele em Configurações.)
                </p>

                <ul className="space-y-2">
                  {aparelhos.lista.map((aparelho) => (
                    <li
                      key={aparelho.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                    >
                      <span className="font-mono text-sm text-text-primary">{aparelho.id}</span>

                      {aparelho.escolhido ? (
                        <span className="text-sm text-sage-dark">É esta</span>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={escolherAparelho.isPending}
                          onClick={() =>
                            escolherAparelho.mutate({
                              terminalId: terminal.id,
                              pointDeviceId: aparelho.id,
                            })
                          }
                        >
                          É esta
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>

                <Button
                  type="button"
                  variant="ghost"
                  className="mt-3"
                  onClick={() => setAparelhos(null)}
                >
                  Fechar
                </Button>
              </div>
            )}

            {configurando === terminal.id && (
              <form
                className="w-full border-t border-border/70 pt-4"
                onSubmit={(evento) => {
                  evento.preventDefault();
                  salvarConta.mutate({ id: terminal.id, ...conta });
                }}
              >
                <p className="mb-3 text-sm text-text-secondary">
                  No painel do Mercado Pago desta conta: <strong>Credenciais de produção</strong> →
                  Access Token. O sistema confere o token com o Mercado Pago antes de guardar, e
                  ele nunca volta para esta tela.
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Access token de produção"
                    type="password"
                    required
                    autoComplete="off"
                    value={conta.accessToken}
                    onChange={(evento) =>
                      setConta((atual) => ({ ...atual, accessToken: evento.target.value }))
                    }
                    placeholder="APP_USR-..."
                  />

                  <Field
                    label="Como chamar esta conta"
                    value={conta.label}
                    onChange={(evento) =>
                      setConta((atual) => ({ ...atual, label: evento.target.value }))
                    }
                    placeholder="Conta da Loja Centro"
                    hint="Vazio: usa o apelido da conta no Mercado Pago."
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="submit" disabled={salvarConta.isPending}>
                    {salvarConta.isPending ? "Conferindo..." : "Conferir e guardar"}
                  </Button>

                  <Button type="button" variant="ghost" onClick={() => setConfigurando(null)}>
                    Cancelar
                  </Button>

                  {terminal.conta?.configurada && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={removerConta.isPending}
                      onClick={() => removerConta.mutate(terminal.id)}
                    >
                      Tirar a conta desta maquininha
                    </Button>
                  )}
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>

      {terminals.data?.length === 0 && !adding && (
        <Alert tone="info">
          Nenhuma maquininha cadastrada. Cadastre para poder cobrar no cartão pelo PDV.
        </Alert>
      )}
    </PageShell>
  );
}
