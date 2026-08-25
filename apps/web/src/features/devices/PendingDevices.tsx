import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";

interface Pendente {
  id: string;
  apelido: string;
  model: string | null;
  osVersion: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  online: boolean;
}

interface StoreRow {
  id: string;
  name: string;
}

/**
 * A fila de tablets esperando uma loja.
 *
 * Aparece dentro da tela de Tablets, acima dos já vinculados: é o que exige
 * ação, e o que já está resolvido pode esperar embaixo.
 *
 * A lista se atualiza sozinha porque o dono costuma estar com o tablet na mão
 * ligando pela primeira vez — e sair da tela para voltar quebraria o momento.
 */
export function PendingDevices({ stores }: { stores: StoreRow[] }) {
  const queryClient = useQueryClient();

  const [vinculando, setVinculando] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [lojaId, setLojaId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const pendentes = useQuery({
    queryKey: ["devices-pending"],
    queryFn: () => apiFetch<Pendente[]>("/api/v1/devices/pending"),
    // Um tablet recém-ligado aparece em segundos, sem ninguém recarregar nada.
    refetchInterval: 8000,
  });

  const vincular = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ name: string; storeName: string }>(`/api/v1/devices/pending/${id}/assign`, {
        method: "POST",
        body: { storeId: lojaId, name: nome.trim() },
      }),
    onSuccess: (resultado) => {
      setErro(null);
      setAviso(`"${resultado.name}" agora é um caixa da ${resultado.storeName}.`);
      setVinculando(null);
      setNome("");
      setLojaId("");
      void queryClient.invalidateQueries({ queryKey: ["devices-pending"] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível vincular."),
  });

  const descartar = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/devices/pending/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setErro(null);
      void queryClient.invalidateQueries({ queryKey: ["devices-pending"] });
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível descartar."),
  });

  const lista = pendentes.data ?? [];

  if (lista.length === 0 && !aviso) return null;

  return (
    <section className="mb-6">
      {aviso && (
        <div className="mb-4">
          <Alert tone="success">{aviso}</Alert>
        </div>
      )}

      {erro && (
        <div className="mb-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}

      {lista.length > 0 && (
        <>
          <h2 className="mb-1 text-lg font-medium text-text-primary">
            {lista.length === 1 ? "Um tablet esperando loja" : `${lista.length} tablets esperando loja`}
          </h2>
          <p className="mb-3 text-sm text-text-secondary">
            Estes aparelhos abriram o sistema e ainda não pertencem a nenhuma loja. Enquanto isso,
            eles não abrem o login.
          </p>

          <ul className="space-y-2">
            {lista.map((pendente) => (
              <li
                key={pendente.id}
                className="rounded-lg border border-border bg-surface p-4 shadow-soft"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-md bg-ocean-soft text-ocean"
                      aria-hidden
                    >
                      <Tablet className="h-5 w-5" />
                    </span>

                    <div>
                      <p className="font-medium text-text-primary">{pendente.apelido}</p>
                      <p className="text-sm text-text-muted">
                        {pendente.osVersion ?? "Android"} ·{" "}
                        {pendente.online ? (
                          <span className="text-sage-dark">ligado agora</span>
                        ) : (
                          `visto em ${new Date(pendente.lastSeenAt).toLocaleString("pt-BR")}`
                        )}
                      </p>
                    </div>
                  </div>

                  {vinculando !== pendente.id && (
                    <div className="flex gap-2">
                      <Button type="button" onClick={() => setVinculando(pendente.id)}>
                        Vincular a uma loja
                      </Button>

                      {/* Um celular que abriu o sistema para testar também cai
                          aqui. Sem esta saída, a fila vira uma lista de coisas
                          a ignorar — e listas assim param de ser lidas. */}
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={descartar.isPending}
                        onClick={() => descartar.mutate(pendente.id)}
                      >
                        Não é da loja
                      </Button>
                    </div>
                  )}
                </div>

                {vinculando === pendente.id && (
                  <form
                    className="mt-4 border-t border-border/70 pt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      vincular.mutate(pendente.id);
                    }}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor={`loja-${pendente.id}`}
                          className="mb-1 block text-sm font-medium text-text-primary"
                        >
                          Loja
                        </label>
                        <select
                          id={`loja-${pendente.id}`}
                          required
                          value={lojaId}
                          onChange={(event) => setLojaId(event.target.value)}
                          className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
                        >
                          <option value="">Selecione</option>
                          {stores.map((loja) => (
                            <option key={loja.id} value={loja.id}>
                              {loja.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <Field
                        label="Nome do tablet"
                        required
                        autoFocus
                        value={nome}
                        onChange={(event) => setNome(event.target.value)}
                        placeholder="Balcão 1"
                        hint="É como ele aparece nos relatórios e na auditoria."
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="submit" disabled={vincular.isPending}>
                        {vincular.isPending ? "Vinculando..." : "Vincular"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setVinculando(null)}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
