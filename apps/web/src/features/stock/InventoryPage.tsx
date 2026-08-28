import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Eye, EyeOff, ListChecks, Lock, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAuth } from "../auth/auth-context";
import { StorePicker } from "@/features/stores/store-picker";
import { useBarcodeScanner } from "@/features/pos/use-barcode-scanner";

/**
 * Contagem de estoque.
 *
 * O módulo existia inteiro no servidor — abrir, contar, fechar, ajustar — e não
 * tinha tela nenhuma. Ninguém conseguia contar o estoque pelo sistema.
 *
 * A contagem é CEGA por padrão: quem conta não vê o saldo do sistema. Isso não
 * é rigor decorativo. Ver o número esperado antes de contar enviesa a
 * contagem: a tendência é "achar" exatamente o que o sistema diz, e a
 * diferença que deveria aparecer some. Uma contagem que sempre bate não prova
 * que o estoque está certo — prova que ninguém contou de verdade.
 *
 * A omissão do saldo acontece no SERVIDOR. Esta tela não recebe o número para
 * esconder; ela recebe nulo. Confiar na tela seria inútil: quem quisesse veria
 * pelo próprio navegador.
 */

interface InventorySummary {
  id: string;
  code: string;
  status: "ABERTO" | "CONTANDO" | "FECHADO" | "CANCELADO";
  isBlind: boolean;
  storeId: string;
  store: { name: string };
  notes: string | null;
  createdAt: string;
  closedAt: string | null;
  _count: { counts: number };
}

interface SheetItem {
  productId: string;
  variationId: string | null;
  sku: string;
  name: string;
  size: string | null;
  /** Nulo = ainda não foi contado. Zero é uma contagem legítima: "não tem". */
  countedQuantity: number | null;
  /** Nulo enquanto a contagem cega está aberta — a omissão vem do servidor. */
  systemQuantity: number | null;
}

interface CountSheet {
  inventory: {
    id: string;
    code: string;
    status: InventorySummary["status"];
    isBlind: boolean;
    storeId: string;
  };
  items: SheetItem[];
}

interface Divergencia {
  productId: string;
  variationId: string | null;
  sistema: number;
  contado: number;
  diferenca: number;
}

const STATUS_LABELS: Record<InventorySummary["status"], string> = {
  ABERTO: "Aberta",
  CONTANDO: "Contando",
  FECHADO: "Encerrada",
  CANCELADO: "Cancelada",
};

const STATUS_TONES: Record<InventorySummary["status"], string> = {
  ABERTO: "bg-ocean-soft text-ocean",
  CONTANDO: "bg-gold-soft text-gold-dark",
  FECHADO: "bg-sage-soft text-sage",
  CANCELADO: "bg-background-secondary text-text-muted",
};

const chaveDo = (item: { productId: string; variationId: string | null }) =>
  `${item.productId}:${item.variationId ?? ""}`;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function InventoryPage() {
  const queryClient = useQueryClient();
  const confirmar = useConfirm();
  const { can, user } = useAuth();
  const podeContar = can("STOCK_INVENTORY");

  const [storeId, setStoreId] = useState("");
  const [abrindo, setAbrindo] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [divergencias, setDivergencias] = useState<Divergencia[] | null>(null);

  const [novaLoja, setNovaLoja] = useState("");
  const [cega, setCega] = useState(true);
  const [observacao, setObservacao] = useState("");

  const [busca, setBusca] = useState("");
  const [soFaltando, setSoFaltando] = useState(false);

  const relatarErro = (caught: unknown) =>
    setErro(caught instanceof ApiError ? caught.message : "Não foi possível concluir.");

  const contagens = useQuery({
    queryKey: ["inventories", storeId],
    queryFn: () =>
      apiFetch<InventorySummary[]>(
        `/api/v1/stock/inventories${storeId ? `?storeId=${storeId}` : ""}`,
      ),
  });

  const folha = useQuery({
    queryKey: ["inventory-sheet", aberta],
    queryFn: () => apiFetch<CountSheet>(`/api/v1/stock/inventories/${aberta}`),
    enabled: aberta !== null,
  });

  const abrir = useMutation({
    mutationFn: () =>
      apiFetch<InventorySummary>("/api/v1/stock/inventories", {
        method: "POST",
        body: {
          storeId: novaLoja,
          isBlind: cega,
          ...(observacao.trim() ? { notes: observacao.trim() } : {}),
        },
      }),
    onSuccess: (nova) => {
      setErro(null);
      setAbrindo(false);
      setObservacao("");
      setAberta(nova.id);
      void queryClient.invalidateQueries({ queryKey: ["inventories"] });
    },
    onError: relatarErro,
  });

  /**
   * Registra o que foi contado de uma peça.
   *
   * Recontar sobrescreve: enquanto a contagem está aberta, o último número
   * dito pelo contador é o que vale. O que não se apaga é a contagem fechada.
   */
  const contar = useMutation({
    mutationFn: (params: { item: SheetItem; quantidade: number }) =>
      apiFetch(`/api/v1/stock/inventories/${aberta}/counts`, {
        method: "POST",
        body: {
          productId: params.item.productId,
          ...(params.item.variationId ? { variationId: params.item.variationId } : {}),
          countedQuantity: params.quantidade,
        },
      }),
    onMutate: (params) => {
      // A folha muda na tela antes da resposta chegar. Quem conta gaveta faz
      // uma peça atrás da outra; esperar o servidor a cada bipe transformaria
      // a contagem numa fila de espera.
      queryClient.setQueryData<CountSheet>(["inventory-sheet", aberta], (atual) =>
        atual
          ? {
              ...atual,
              items: atual.items.map((item) =>
                chaveDo(item) === chaveDo(params.item)
                  ? { ...item, countedQuantity: params.quantidade }
                  : item,
              ),
            }
          : atual,
      );
    },
    onError: (caught) => {
      relatarErro(caught);
      void queryClient.invalidateQueries({ queryKey: ["inventory-sheet", aberta] });
    },
  });

  const encerrar = useMutation({
    mutationFn: () =>
      apiFetch<{ inventoryId: string; divergencias: Divergencia[] }>(
        `/api/v1/stock/inventories/${aberta}/close`,
        { method: "POST" },
      ),
    onSuccess: (resultado) => {
      setErro(null);
      setDivergencias(resultado.divergencias);
      setAviso(
        resultado.divergencias.length === 0
          ? "Contagem encerrada. Tudo bateu com o sistema."
          : `Contagem encerrada com ${resultado.divergencias.length} diferença(s). O estoque foi ajustado e cada diferença ficou no histórico da peça.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["inventories"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory-sheet", aberta] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: relatarErro,
  });

  // Memorizado porque a lista alimenta um `useMemo` de filtro: recriar o
  // array vazio a cada render refaria o filtro de milhares de linhas sem que
  // nada tivesse mudado.
  const itens = useMemo(() => folha.data?.items ?? [], [folha.data]);
  const emAndamento =
    folha.data?.inventory.status === "ABERTO" || folha.data?.inventory.status === "CONTANDO";

  const contados = itens.filter((item) => item.countedQuantity !== null).length;

  /**
   * O leitor de código de barras conta somando.
   *
   * É o gesto da gaveta: pega a peça, bipa, põe de lado, pega a próxima. Bipar
   * a mesma peça duas vezes significa que há duas — por isso soma em vez de
   * substituir.
   */
  useBarcodeScanner((codigo) => {
    if (aberta === null || !emAndamento) return;

    const alvo = itens.find((item) => item.sku.toLowerCase() === codigo.trim().toLowerCase());

    if (!alvo) {
      // Peça que existe na mão e não está na lista é informação, não erro de
      // digitação: quase sempre é peça que chegou na loja sem ser registrada.
      setAviso(null);
      setErro(`O código ${codigo} não está na lista desta loja.`);
      return;
    }

    setErro(null);
    contar.mutate({ item: alvo, quantidade: (alvo.countedQuantity ?? 0) + 1 });
  });

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return itens.filter((item) => {
      if (soFaltando && item.countedQuantity !== null) return false;
      if (!termo) return true;
      return (
        item.name.toLowerCase().includes(termo) || item.sku.toLowerCase().includes(termo)
      );
    });
  }, [itens, busca, soFaltando]);

  // ------------------------------------------------------------ a folha
  if (aberta && folha.data) {
    const inventario = folha.data.inventory;

    return (
      <PageShell
        eyebrow="Estoque"
        title={`Contagem ${inventario.code}`}
        description={
          inventario.isBlind && emAndamento
            ? "Contagem cega: você conta primeiro, o saldo do sistema aparece só no fim."
            : "O saldo do sistema está à vista nesta contagem."
        }
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => setAberta(null)}>
              Voltar às contagens
            </Button>

            {emAndamento && (
              <Button
                type="button"
                disabled={encerrar.isPending || contados === 0}
                onClick={async () => {
                  const ok = await confirmar({
                    titulo: `Encerrar a contagem ${inventario.code}?`,
                    descricao:
                      "O estoque passa a ser o que você contou. Cada diferença vira um movimento no histórico da peça — falta sai como perda, sobra entra como inventário. Depois de encerrada não dá para recontar.",
                    acao: "Encerrar e ajustar",
                  });

                  if (ok !== null) encerrar.mutate();
                }}
              >
                <Lock className="h-5 w-5" aria-hidden />
                Encerrar contagem
              </Button>
            )}
          </>
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

        {divergencias && divergencias.length > 0 && (
          <div className="mb-6 rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-3 font-medium text-text-primary">
              O que não bateu ({divergencias.length})
            </h2>
            <ul className="space-y-2">
              {divergencias.map((linha) => {
                const item = itens.find((i) => chaveDo(i) === chaveDo(linha));
                return (
                  <li
                    key={chaveDo(linha)}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-0"
                  >
                    <span className="text-text-primary">
                      {item?.name ?? linha.productId}
                      {item?.size ? ` — tam. ${item.size}` : ""}
                    </span>
                    <span className="text-text-secondary">
                      sistema {linha.sistema} · contado {linha.contado} ·{" "}
                      <strong className={linha.diferenca < 0 ? "text-danger" : "text-success"}>
                        {linha.diferenca > 0 ? `+${linha.diferenca}` : linha.diferenca}
                      </strong>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {emAndamento && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background-secondary p-4">
            <ScanLine className="h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
            <p className="text-sm text-text-secondary">
              Pode bipar o código de barras da peça — cada bipe soma uma. Ou digite a quantidade na
              linha.
            </p>
          </div>
        )}

        <div className="mb-5 flex flex-wrap items-end gap-4">
          <div className="min-w-[14rem] flex-1">
            <Field
              label="Procurar na lista"
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Nome ou código"
            />
          </div>

          <label className="flex min-h-[48px] items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              className="h-5 w-5 accent-rose-primary"
              checked={soFaltando}
              onChange={(evento) => setSoFaltando(evento.target.checked)}
            />
            Só o que falta contar
          </label>

          <p className="text-sm text-text-secondary">
            {contados} de {itens.length} contadas
          </p>
        </div>

        {itens.length === 0 && (
          <Alert tone="info">
            Esta loja não tem peça nenhuma em estoque para contar.
          </Alert>
        )}

        <ul className="space-y-2">
          {visiveis.slice(0, 200).map((item) => (
            <li
              key={chaveDo(item)}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4"
            >
              <div className="min-w-[12rem] flex-1">
                <p className="font-medium text-text-primary">
                  {item.name}
                  {item.size ? ` — tam. ${item.size}` : ""}
                </p>
                <p className="text-sm text-text-secondary">{item.sku}</p>
              </div>

              {/*
                O saldo do sistema só aparece quando o servidor o manda: em
                contagem aberta, ou depois de encerrada. Enquanto a contagem
                cega corre, este campo chega nulo.
              */}
              {item.systemQuantity !== null && (
                <p className="text-sm text-text-secondary">
                  sistema: <strong className="text-text-primary">{item.systemQuantity}</strong>
                </p>
              )}

              {emAndamento ? (
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  aria-label={`Quantidade contada de ${item.name}`}
                  className="min-h-[48px] w-28 rounded-md border border-border bg-surface px-4 text-center text-base text-text-primary outline-none focus:border-rose-primary focus:ring-2 focus:ring-rose-soft"
                  value={item.countedQuantity ?? ""}
                  placeholder="—"
                  onChange={(evento) => {
                    const valor = evento.target.value;
                    if (valor === "") return;

                    const quantidade = Math.max(0, Math.trunc(Number(valor)));
                    if (!Number.isFinite(quantidade)) return;

                    setErro(null);
                    contar.mutate({ item, quantidade });
                  }}
                />
              ) : (
                <p className="text-sm text-text-secondary">
                  contado: <strong className="text-text-primary">{item.countedQuantity ?? "—"}</strong>
                </p>
              )}
            </li>
          ))}
        </ul>

        {visiveis.length > 200 && (
          <p className="mt-4 text-sm text-text-muted">
            Mostrando 200 de {visiveis.length}. Use a busca ou bipe o código para chegar na peça.
          </p>
        )}
      </PageShell>
    );
  }

  // ----------------------------------------------------- lista de contagens
  return (
    <PageShell
      eyebrow="Estoque"
      title="Contagem de estoque"
      description="Conferir peça por peça o que existe na gaveta e acertar o sistema pelo que foi contado."
      actions={
        podeContar && !abrindo ? (
          <Button
            type="button"
            onClick={() => {
              setAbrindo(true);
              setNovaLoja(storeId || (user?.storeIds.length === 1 ? user.storeIds[0] ?? "" : ""));
            }}
          >
            <ClipboardCheck className="h-5 w-5" aria-hidden />
            Abrir contagem
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

      {abrindo && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(evento) => {
            evento.preventDefault();
            abrir.mutate();
          }}
        >
          <h2 className="mb-4 font-medium text-text-primary">Nova contagem</h2>

          <StorePicker storeId={novaLoja} onChange={setNovaLoja} className="mb-4 max-w-xs" />

          <Field
            label="Observação"
            value={observacao}
            onChange={(evento) => setObservacao(evento.target.value)}
            hint="Opcional. Ex.: conferência do fim do mês."
          />

          {/*
            Só o dono pode contar com o saldo à vista, e o servidor recusa de
            qualquer forma. O interruptor some para os outros em vez de
            aparecer e falhar no envio.
          */}
          {user?.role === "DONO" && (
            <label className="mt-4 flex items-start gap-3 text-sm text-text-secondary">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-rose-primary"
                checked={!cega}
                onChange={(evento) => setCega(!evento.target.checked)}
              />
              <span>
                <span className="flex items-center gap-2 font-medium text-text-primary">
                  {cega ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                  Mostrar o saldo do sistema durante a contagem
                </span>
                Deixe desmarcado. Ver o número esperado antes de contar faz a pessoa "achar"
                exatamente o que o sistema diz, e a diferença que deveria aparecer some. Esta
                escolha fica registrada na auditoria.
              </span>
            </label>
          )}

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={abrir.isPending || novaLoja === ""}>
              {abrir.isPending ? "Abrindo..." : "Abrir e começar a contar"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setAbrindo(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <StorePicker storeId={storeId} onChange={setStoreId} todas className="mb-5 max-w-xs" />

      {contagens.data?.length === 0 && (
        <Alert tone="info">
          Nenhuma contagem ainda. Prata é peça pequena e cara: contar de tempos em tempos é o que
          mantém o número do sistema merecendo confiança.
        </Alert>
      )}

      <ul className="space-y-3">
        {contagens.data?.map((contagem) => (
          <li
            key={contagem.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5"
          >
            <div>
              <p className="font-medium text-text-primary">
                {contagem.code}
                <span
                  className={`ml-2 rounded px-2 py-0.5 text-sm ${STATUS_TONES[contagem.status]}`}
                >
                  {STATUS_LABELS[contagem.status]}
                </span>
                {contagem.isBlind ? null : (
                  <span className="ml-2 rounded bg-gold-soft px-2 py-0.5 text-sm text-gold-dark">
                    saldo à vista
                  </span>
                )}
              </p>
              <p className="text-sm text-text-secondary">
                {contagem.store.name} · aberta em {formatDate(contagem.createdAt)} ·{" "}
                {contagem._count.counts} peça(s) contada(s)
                {contagem.closedAt ? ` · encerrada em ${formatDate(contagem.closedAt)}` : ""}
              </p>
              {contagem.notes && (
                <p className="mt-1 text-sm text-text-muted">{contagem.notes}</p>
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDivergencias(null);
                setAviso(null);
                setErro(null);
                setBusca("");
                setSoFaltando(false);
                setAberta(contagem.id);
              }}
            >
              <ListChecks className="h-5 w-5" aria-hidden />
              {contagem.status === "FECHADO" || contagem.status === "CANCELADO"
                ? "Ver"
                : "Continuar contando"}
            </Button>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
