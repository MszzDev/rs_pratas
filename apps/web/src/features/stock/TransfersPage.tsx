import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Ban,
  PackageCheck,
  Plus,
  Send,
  Trash2,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAuth } from "../auth/auth-context";
import { StorePicker, useLoja } from "@/features/stores/store-picker";

/**
 * Transferência de peças entre as lojas.
 *
 * Existia inteira no servidor e não tinha tela. Na prática isso significava
 * que mover uma peça de uma loja para outra só dava para fazer com dois
 * ajustes manuais — e ajuste manual não guarda quem mandou, quem recebeu, nem
 * o que ficou no caminho.
 *
 * São dois atos, e não um, porque a peça leva tempo na estrada. Baixar da
 * origem e somar no destino no mesmo instante faria o sistema afirmar que a
 * peça está na loja B enquanto ela ainda está dentro de um carro. Entre sair e
 * chegar, ela não está em loja nenhuma: é isso que "a caminho" quer dizer, e é
 * exatamente onde peça some se ninguém confere na chegada.
 */

interface TransferItem {
  id: string;
  productId: string;
  variationId: string | null;
  quantitySent: number;
  quantityReceived: number | null;
}

interface Transfer {
  id: string;
  code: string;
  status: "RASCUNHO" | "EM_TRANSITO" | "RECEBIDA" | "CANCELADA";
  fromStoreId: string;
  toStoreId: string;
  fromStore: { name: string };
  toStore: { name: string };
  notes: string | null;
  cancelReason: string | null;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  items: TransferItem[];
}

interface StockRow {
  id: string;
  productId: string;
  variationId: string | null;
  sku: string;
  name: string;
  size: string | null;
  availableQuantity: number;
}

/** Uma linha do rascunho, ainda em montagem na tela. */
interface Escolhida {
  productId: string;
  variationId: string | null;
  sku: string;
  name: string;
  size: string | null;
  disponivel: number;
  quantidade: number;
}

const STATUS_LABELS: Record<Transfer["status"], string> = {
  RASCUNHO: "Rascunho",
  EM_TRANSITO: "A caminho",
  RECEBIDA: "Recebida",
  CANCELADA: "Cancelada",
};

const STATUS_TONES: Record<Transfer["status"], string> = {
  RASCUNHO: "bg-background-secondary text-text-secondary",
  EM_TRANSITO: "bg-gold-soft text-gold-dark",
  RECEBIDA: "bg-sage-soft text-sage",
  CANCELADA: "bg-background-secondary text-text-muted",
};

const chaveDe = (linha: { productId: string; variationId: string | null }) =>
  `${linha.productId}:${linha.variationId ?? ""}`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function TransfersPage() {
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const { can, user } = useAuth();
  const podeTransferir = can("STOCK_TRANSFER");

  const [storeId, setStoreId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [montando, setMontando] = useState(false);
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [observacao, setObservacao] = useState("");
  const [busca, setBusca] = useState("");
  const [escolhidas, setEscolhidas] = useState<Escolhida[]>([]);

  /** Transferência aberta para conferir na chegada, e o que foi contado nela. */
  const [recebendo, setRecebendo] = useState<Transfer | null>(null);
  const [conferido, setConferido] = useState<Record<string, number>>({});

  const { lojas } = useLoja(storeId, setStoreId);

  const relatarErro = (caught: unknown) =>
    setErro(caught instanceof ApiError ? caught.message : "Não foi possível concluir.");

  const transferencias = useQuery({
    queryKey: ["transfers", storeId],
    queryFn: () =>
      apiFetch<Transfer[]>(`/api/v1/stock/transfers${storeId ? `?storeId=${storeId}` : ""}`),
  });

  /**
   * O que a loja de origem tem para mandar.
   *
   * Vem do estoque e não do catálogo: o que interessa é o que existe naquele
   * balcão agora. Oferecer o catálogo inteiro deixaria montar uma remessa de
   * peça que a loja não tem, e o erro só apareceria no despacho.
   */
  const disponivel = useQuery({
    queryKey: ["stock", origem, busca],
    queryFn: () =>
      apiFetch<StockRow[]>(
        `/api/v1/stock?storeId=${origem}&search=${encodeURIComponent(busca.trim())}`,
      ),
    enabled: montando && origem !== "" && busca.trim().length >= 2,
  });

  const criar = useMutation({
    mutationFn: () =>
      apiFetch<Transfer>("/api/v1/stock/transfers", {
        method: "POST",
        body: {
          fromStoreId: origem,
          toStoreId: destino,
          ...(observacao.trim() ? { notes: observacao.trim() } : {}),
          items: escolhidas.map((linha) => ({
            productId: linha.productId,
            ...(linha.variationId ? { variationId: linha.variationId } : {}),
            quantity: linha.quantidade,
          })),
        },
      }),
    onSuccess: (nova) => {
      setErro(null);
      setAviso(
        `Remessa ${nova.code} montada. Ela ainda está na loja: as peças só saem do estoque quando você despachar.`,
      );
      setMontando(false);
      setEscolhidas([]);
      setObservacao("");
      setBusca("");
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
    },
    onError: relatarErro,
  });

  const despachar = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/stock/transfers/${id}/send`, { method: "POST" }),
    onSuccess: () => {
      setErro(null);
      setAviso("Despachada. As peças saíram do estoque da origem e estão a caminho.");
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: relatarErro,
  });

  const receber = useMutation({
    mutationFn: (transferencia: Transfer) =>
      apiFetch<{ divergencias: Array<{ itemId: string; enviado: number; recebido: number }> }>(
        `/api/v1/stock/transfers/${transferencia.id}/receive`,
        {
          method: "POST",
          body: {
            counted: transferencia.items.map((item) => ({
              itemId: item.id,
              quantityReceived: conferido[item.id] ?? 0,
            })),
          },
        },
      ),
    onSuccess: (resultado) => {
      setErro(null);
      setAviso(
        resultado.divergencias.length === 0
          ? "Recebida. Chegou tudo o que foi enviado."
          : `Recebida com ${resultado.divergencias.length} diferença(s). A falta ficou registrada — é o número que mostra peça perdida no caminho.`,
      );
      setRecebendo(null);
      setConferido({});
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: relatarErro,
  });

  const cancelar = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      apiFetch(`/api/v1/stock/transfers/${params.id}/cancel`, {
        method: "POST",
        body: { reason: params.reason },
      }),
    onSuccess: () => {
      setErro(null);
      setAviso("Rascunho cancelado. Nenhuma peça chegou a sair do estoque.");
      void queryClient.invalidateQueries({ queryKey: ["transfers"] });
    },
    onError: relatarErro,
  });

  // ------------------------------------------------- conferência na chegada
  if (recebendo) {
    const tudoConferido = recebendo.items.every((item) => conferido[item.id] !== undefined);

    return (
      <PageShell
        eyebrow="Estoque"
        title={`Receber a remessa ${recebendo.code}`}
        description={`De ${recebendo.fromStore.name} para ${recebendo.toStore.name}. Conte cada peça e diga quantas chegaram.`}
        actions={
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setRecebendo(null);
              setConferido({});
            }}
          >
            Voltar
          </Button>
        }
      >
        {erro && (
          <div className="mb-5">
            <Alert tone="error">{erro}</Alert>
          </div>
        )}

        <div className="mb-5">
          <Alert tone="info">
            O que entra no estoque é o que você CONTAR, não o que foi enviado. Se chegou menos, a
            diferença fica registrada — é justamente esse número que denuncia peça perdida no
            caminho.
          </Alert>
        </div>

        <ul className="mb-6 space-y-2">
          {recebendo.items.map((item) => {
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4"
              >
                <div className="min-w-[12rem] flex-1">
                  <ItemDaRemessa item={item} />
                </div>

                <p className="text-sm text-text-secondary">
                  enviadas: <strong className="text-text-primary">{item.quantitySent}</strong>
                </p>

                <input
                  type="number"
                  min={0}
                  max={item.quantitySent}
                  inputMode="numeric"
                  aria-label="Quantas chegaram"
                  placeholder="—"
                  className="min-h-[48px] w-28 rounded-md border border-border bg-surface px-4 text-center text-base text-text-primary outline-none focus:border-rose-primary focus:ring-2 focus:ring-rose-soft"
                  value={conferido[item.id] ?? ""}
                  onChange={(evento) => {
                    const valor = evento.target.value;
                    if (valor === "") {
                      setConferido((atual) => {
                        const copia = { ...atual };
                        delete copia[item.id];
                        return copia;
                      });
                      return;
                    }

                    const quantidade = Math.max(
                      0,
                      Math.min(item.quantitySent, Math.trunc(Number(valor))),
                    );
                    if (!Number.isFinite(quantidade)) return;

                    setConferido((atual) => ({ ...atual, [item.id]: quantidade }));
                  }}
                />
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={receber.isPending || !tudoConferido}
            onClick={() => receber.mutate(recebendo)}
          >
            <PackageCheck className="h-5 w-5" aria-hidden />
            {receber.isPending ? "Registrando..." : "Concluir recebimento"}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setConferido(
                Object.fromEntries(
                  recebendo.items.map((item) => [item.id, item.quantitySent]),
                ),
              )
            }
          >
            Chegou tudo
          </Button>
        </div>

        {!tudoConferido && (
          <p className="mt-3 text-sm text-text-muted">
            Falta dizer quantas chegaram de cada peça. Zero também é resposta.
          </p>
        )}
      </PageShell>
    );
  }

  // ------------------------------------------------------------- a listagem
  return (
    <PageShell
      eyebrow="Estoque"
      title="Transferências entre lojas"
      description="Mandar peça de uma loja para outra sem perder o rastro de quem enviou, quem recebeu e o que ficou no caminho."
      actions={
        podeTransferir && !montando ? (
          <Button
            type="button"
            onClick={() => {
              setMontando(true);
              setErro(null);
              setAviso(null);
              setOrigem(storeId || (user?.storeIds.length === 1 ? user.storeIds[0] ?? "" : ""));
            }}
          >
            <Plus className="h-5 w-5" aria-hidden />
            Nova remessa
          </Button>
        ) : null
      }
    >
      {erro && (
        <div className="mb-5">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}

      {aviso && (
        <div className="mb-5">
          <Alert tone="success">{aviso}</Alert>
        </div>
      )}

      {montando && (
        <div className="mb-6 rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-4 font-medium text-text-primary">Nova remessa</h2>

          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <StorePicker
              storeId={origem}
              onChange={setOrigem}
              label="Sai de"
              className="max-w-full"
            />

            <div>
              <label
                className="mb-1 block text-sm font-medium text-text-primary"
                htmlFor="loja-destino"
              >
                Vai para
              </label>
              <select
                id="loja-destino"
                value={destino}
                onChange={(evento) => setDestino(evento.target.value)}
                className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
              >
                <option value="">Selecione</option>
                {lojas
                  .filter((loja) => loja.id !== origem)
                  .map((loja) => (
                    <option key={loja.id} value={loja.id}>
                      {loja.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {origem === "" ? (
            <Alert tone="info">Escolha a loja de origem para ver o que ela tem para mandar.</Alert>
          ) : (
            <>
              <Field
                label="Procurar a peça no estoque da origem"
                value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Nome ou código"
                hint="Digite ao menos duas letras."
              />

              <ul className="mt-3 space-y-2">
                {disponivel.data
                  ?.filter((linha) => linha.availableQuantity > 0)
                  .filter((linha) => !escolhidas.some((e) => chaveDe(e) === chaveDe(linha)))
                  .slice(0, 10)
                  .map((linha) => (
                    <li key={linha.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-md border border-border p-3 text-left hover:bg-background-secondary"
                        onClick={() =>
                          setEscolhidas((atual) => [
                            ...atual,
                            {
                              productId: linha.productId,
                              variationId: linha.variationId,
                              sku: linha.sku,
                              name: linha.name,
                              size: linha.size,
                              disponivel: linha.availableQuantity,
                              quantidade: 1,
                            },
                          ])
                        }
                      >
                        <span>
                          <span className="block font-medium text-text-primary">
                            {linha.name}
                            {linha.size ? ` — tam. ${linha.size}` : ""}
                          </span>
                          <span className="block text-sm text-text-secondary">{linha.sku}</span>
                        </span>
                        <span className="text-sm text-text-secondary">
                          {linha.availableQuantity} na loja
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          )}

          {escolhidas.length > 0 && (
            <ul className="mt-5 space-y-2">
              {escolhidas.map((linha) => (
                <li
                  key={chaveDe(linha)}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background-secondary p-3"
                >
                  <span className="min-w-[10rem] flex-1">
                    <span className="block font-medium text-text-primary">
                      {linha.name}
                      {linha.size ? ` — tam. ${linha.size}` : ""}
                    </span>
                    <span className="block text-sm text-text-secondary">
                      {linha.sku} · {linha.disponivel} na loja
                    </span>
                  </span>

                  <input
                    type="number"
                    min={1}
                    max={linha.disponivel}
                    inputMode="numeric"
                    aria-label={`Quantas peças de ${linha.name}`}
                    className="min-h-[48px] w-24 rounded-md border border-border bg-surface px-4 text-center text-base text-text-primary outline-none focus:border-rose-primary focus:ring-2 focus:ring-rose-soft"
                    value={linha.quantidade}
                    onChange={(evento) => {
                      // O teto é o disponível na origem. Deixar pedir mais só
                      // adiaria a recusa para o momento do despacho, quando a
                      // remessa já estaria montada.
                      const valor = Math.max(
                        1,
                        Math.min(linha.disponivel, Math.trunc(Number(evento.target.value)) || 1),
                      );
                      setEscolhidas((atual) =>
                        atual.map((item) =>
                          chaveDe(item) === chaveDe(linha)
                            ? { ...item, quantidade: valor }
                            : item,
                        ),
                      );
                    }}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Tirar ${linha.name} da remessa`}
                    onClick={() =>
                      setEscolhidas((atual) =>
                        atual.filter((item) => chaveDe(item) !== chaveDe(linha)),
                      )
                    }
                  >
                    <Trash2 className="h-5 w-5" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <Field
              label="Observação"
              value={observacao}
              onChange={(evento) => setObservacao(evento.target.value)}
              hint="Opcional. Ex.: quem vai levar."
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={
                criar.isPending || origem === "" || destino === "" || escolhidas.length === 0
              }
              onClick={() => criar.mutate()}
            >
              {criar.isPending ? "Montando..." : "Montar remessa"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMontando(false);
                setEscolhidas([]);
                setBusca("");
              }}
            >
              Cancelar
            </Button>
          </div>

          <p className="mt-3 text-sm text-text-muted">
            Montar não tira peça do estoque. Isso acontece no despacho, num segundo passo — para a
            origem não continuar oferecendo à venda uma peça que já está na estrada.
          </p>
        </div>
      )}

      <StorePicker storeId={storeId} onChange={setStoreId} todas className="mb-5 max-w-xs" />

      {transferencias.data?.length === 0 && (
        <Alert tone="info">
          Nenhuma transferência ainda. Enquanto peça mudar de loja por ajuste manual, o histórico
          não guarda quem mandou nem quem recebeu.
        </Alert>
      )}

      <ul className="space-y-3">
        {transferencias.data?.map((transferencia) => {
          const chegouMenos =
            transferencia.status === "RECEBIDA" &&
            transferencia.items.some(
              (item) => (item.quantityReceived ?? 0) !== item.quantitySent,
            );

          return (
            <li
              key={transferencia.id}
              className="rounded-lg border border-border bg-surface p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="font-medium text-text-primary">
                    {transferencia.code}
                    <span
                      className={`ml-2 rounded px-2 py-0.5 text-sm ${STATUS_TONES[transferencia.status]}`}
                    >
                      {STATUS_LABELS[transferencia.status]}
                    </span>
                    {chegouMenos && (
                      <span className="ml-2 rounded bg-danger/10 px-2 py-0.5 text-sm text-danger">
                        chegou menos do que saiu
                      </span>
                    )}
                  </p>

                  <p className="flex flex-wrap items-center gap-1 text-sm text-text-secondary">
                    {transferencia.fromStore.name}
                    <ArrowRightLeft className="h-4 w-4" aria-hidden />
                    {transferencia.toStore.name} · {transferencia.items.length} peça(s) ·{" "}
                    {formatDate(transferencia.createdAt)}
                  </p>

                  {transferencia.notes && (
                    <p className="mt-1 text-sm text-text-muted">{transferencia.notes}</p>
                  )}
                  {transferencia.cancelReason && (
                    <p className="mt-1 text-sm text-text-muted">
                      Cancelada: {transferencia.cancelReason}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {/*
                    Despachar exige acesso à ORIGEM; receber, ao DESTINO. Quem
                    está numa ponta não vê o botão da outra — o servidor recusa
                    de qualquer forma, e um botão que só dá erro é pior que
                    botão nenhum.
                  */}
                  {podeTransferir &&
                    transferencia.status === "RASCUNHO" &&
                    alcanca(user, transferencia.fromStoreId) && (
                      <>
                        <Button
                          type="button"
                          disabled={despachar.isPending}
                          onClick={async () => {
                            const ok = await confirmar({
                              titulo: `Despachar a remessa ${transferencia.code}?`,
                              descricao:
                                "As peças saem do estoque da origem agora e ficam a caminho, sem estar em loja nenhuma, até a chegada ser conferida.",
                              acao: "Despachar",
                            });

                            if (ok !== null) despachar.mutate(transferencia.id);
                          }}
                        >
                          <Send className="h-5 w-5" aria-hidden />
                          Despachar
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          disabled={cancelar.isPending}
                          onClick={async () => {
                            const motivo = await confirmar({
                              titulo: `Cancelar a remessa ${transferencia.code}?`,
                              descricao:
                                "Ela ainda não saiu, então nenhuma peça foi movida. Depois de despachada o caminho é receber, mesmo que não chegue nada.",
                              acao: "Cancelar remessa",
                              destrutivo: true,
                              pedirMotivo: true,
                            });

                            if (motivo !== null) {
                              cancelar.mutate({ id: transferencia.id, reason: motivo });
                            }
                          }}
                        >
                          <Ban className="h-5 w-5" aria-hidden />
                          Cancelar
                        </Button>
                      </>
                    )}

                  {podeTransferir &&
                    transferencia.status === "EM_TRANSITO" &&
                    alcanca(user, transferencia.toStoreId) && (
                      <Button
                        type="button"
                        onClick={() => {
                          setErro(null);
                          setAviso(null);
                          setConferido({});
                          setRecebendo(transferencia);
                        }}
                      >
                        <Truck className="h-5 w-5" aria-hidden />
                        Conferir e receber
                      </Button>
                    )}
                </div>
              </div>

              {transferencia.status === "RECEBIDA" && (
                <p className="mt-3 text-sm text-text-secondary">
                  Recebida em {transferencia.receivedAt ? formatDate(transferencia.receivedAt) : "—"}
                  {": "}
                  {transferencia.items
                    .map((item) => `${item.quantityReceived ?? 0} de ${item.quantitySent}`)
                    .join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </PageShell>
  );
}

/**
 * O dono alcança todas as lojas; os demais, só as suas.
 *
 * A tela usa isto para esconder botão que o servidor recusaria — conveniência,
 * não segurança: a decisão que vale continua sendo a de lá.
 */
function alcanca(
  user: { role: string; storeIds: string[] } | null,
  storeId: string,
): boolean {
  if (!user) return false;
  if (user.role === "DONO") return true;
  return user.storeIds.includes(storeId);
}

/**
 * O nome da peça dentro da remessa.
 *
 * A transferência guarda o produto por id, não por nome — o nome é do catálogo
 * e pode mudar depois. Aqui buscamos o nome atual para quem confere reconhecer
 * a peça na mão.
 */
function ItemDaRemessa({ item }: { item: TransferItem }) {
  const produto = useQuery({
    queryKey: ["product", item.productId],
    queryFn: () =>
      apiFetch<{ name: string; sku: string; variations: Array<{ id: string; size: string | null }> }>(
        `/api/v1/products/${item.productId}`,
      ),
  });

  if (!produto.data) {
    return <p className="text-text-secondary">Carregando...</p>;
  }

  const tamanho = item.variationId
    ? produto.data.variations.find((variacao) => variacao.id === item.variationId)?.size
    : null;

  return (
    <>
      <p className="font-medium text-text-primary">
        {produto.data.name}
        {tamanho ? ` — tam. ${tamanho}` : ""}
      </p>
      <p className="text-sm text-text-secondary">{produto.data.sku}</p>
    </>
  );
}
