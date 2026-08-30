import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Layers,
  PenLine,
  Star,
  Printer,
  Tag,
  Trash2,
} from "lucide-react";
import type { LabelElement } from "@rs-pratas/shared";
import { LabelSheet } from "./LabelSheet";
import { LabelEditor } from "./LabelEditor";
import { LabelQuickPrint } from "./LabelQuickPrint";
import type { LabelPayload, LabelToPrint } from "./LabelSheet";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatMoney } from "@/lib/money";
import { ProductPhoto } from "@/components/ui/product-photo";
import { useAuth } from "../auth/auth-context";
import { StorePicker } from "@/features/stores/store-picker";

interface Template {
  id: string;
  code: string;
  name: string;
  widthMm: string;
  heightMm: string;
  gapXMm: string;
  gapYMm: string;
  columnsPerRow: number;
  isDoubleSided: boolean;
  showProductName: boolean;
  showSku: boolean;
  showPrice: boolean;
  showWeight: boolean;
  showSize: boolean;
  showBarcode: boolean;
  isDefault: boolean;
  /** O desenho montado no editor. Nulo = ainda usa o formato empilhado. */
  elements: LabelElement[] | null;
}

interface PrintJob {
  id: string;
  type: string;
  status: string;
  copies: number;
  lastError: string | null;
  createdAt: string;
  payload: LabelPayload;
}


interface BatchRow {
  productId: string;
  variationId: string | null;
  sku: string;
  name: string;
  size: string | null;
  copies: number;
  salePrice: string | null;
  imageChecksum: string | null;
  imageExternalUrl: string | null;
}

/**
 * Os rolos que a loja usa.
 *
 * Existem porque quase toda etiqueta nova é uma destas três, e digitar
 * "90" e "12" nos campos certos é onde se erra: sai um rolo inteiro no
 * tamanho errado antes de alguém reparar. Os campos continuam abertos —
 * o atalho preenche, não decide.
 */
const TAMANHOS_PRONTOS: Array<{
  larguraMm: number;
  alturaMm: number;
  colunas: number;
  folgaMm: number;
  para: string;
  dupla: boolean;
}> = [
  // O rolo da loja: três colunas de 33 mm, com 1,2 mm de folga entre elas.
  {
    larguraMm: 33,
    alturaMm: 21,
    colunas: 3,
    folgaMm: 1.2,
    para: "rolo de três colunas, o da loja",
    dupla: false,
  },
  // Comprida e estreita: dobra na argola e o preço fica dos dois lados.
  { larguraMm: 90, alturaMm: 12, colunas: 1, folgaMm: 0, para: "joia, dobrada na argola", dupla: true },
  {
    larguraMm: 30,
    alturaMm: 20,
    colunas: 1,
    folgaMm: 0,
    para: "peça na caixa ou no mostruário",
    dupla: false,
  },
];

/**
 * Completa o formato do rolo num trabalho antigo.
 *
 * O `payload` é congelado quando a etiqueta entra na fila, para o preço sair
 * como estava quando foi pedida. O efeito colateral é que um trabalho criado
 * antes de o sistema conhecer rolo de várias colunas carrega essa informação
 * ausente para sempre — e imprime numa coluna só, desperdiçando duas de cada
 * três etiquetas, mesmo depois do modelo estar certo.
 *
 * Aqui o formato é completado a partir do modelo atual. Só o formato: preço,
 * nome e código continuam vindo congelados, que é o ponto de congelar.
 */
function comFormatoDoRolo(payload: LabelPayload, modelos: Template[]): LabelPayload {
  if (payload.layout.columnsPerRow !== undefined) return payload;

  // Casa pelo tamanho: é o que identifica o rolo, e o trabalho não guarda de
  // qual modelo veio.
  const modelo = modelos.find(
    (m) =>
      Number(m.widthMm) === payload.layout.widthMm &&
      Number(m.heightMm) === payload.layout.heightMm,
  );

  if (!modelo) return payload;

  return {
    ...payload,
    layout: {
      ...payload.layout,
      columnsPerRow: modelo.columnsPerRow,
      gapXMm: Number(modelo.gapXMm),
      gapYMm: Number(modelo.gapYMm),
    },
  };
}

/** Produto sem tamanho e produto com tamanho são linhas distintas do lote. */
const keyOf = (row: { productId: string; variationId: string | null }) =>
  `${row.productId}:${row.variationId ?? ""}`;

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * Etiquetas.
 *
 * Quem imprime é o tablet, na rede da impressora. Esta tela cuida do modelo,
 * da calibração e mostra a fila — inclusive o que falhou, que é o ponto: sem
 * ver a falha, o funcionário reimprime até a peça ficar com duas etiquetas de
 * preços diferentes.
 */
export function LabelsPage() {
  const confirmar = useConfirm();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [desenhando, setDesenhando] = useState<Template | null>(null);
  const [avulsa, setAvulsa] = useState(false);

  /**
   * O modelo que o LOTE usa.
   *
   * Separado do padrão da empresa pelo mesmo motivo da impressão avulsa: a
   * virada de estoque pode pedir um rolo diferente do que fica no balcão, e
   * trocar o padrão inteiro para isso é mudar uma escolha da empresa para
   * resolver um caso do dia.
   */
  const [modeloDoLote, setModeloDoLote] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batch, setBatch] = useState<Record<string, number>>({});
  const [aviso, setAviso] = useState<string | null>(null);

  /**
   * O que está na folha de impressão neste instante.
   *
   * Fica em estado próprio porque a folha precisa estar montada no DOM ANTES
   * de `window.print()` ser chamado — o navegador imprime o que existe na
   * página naquele momento, não o que vai existir depois do próximo render.
   */
  const [paraImprimir, setParaImprimir] = useState<LabelToPrint[]>([]);

  const [form, setForm] = useState({
    code: "",
    name: "",
    widthMm: "50",
    heightMm: "12",
    gapXMm: "0",
    gapYMm: "0",
    columnsPerRow: 1,
    isDoubleSided: true,
    showProductName: true,
    showSku: true,
    showPrice: true,
    showWeight: false,
    showSize: true,
    showBarcode: true,
    isDefault: false,
  });



  const templates = useQuery({
    queryKey: ["label-templates"],
    queryFn: () => apiFetch<Template[]>("/api/v1/label-templates"),
  });

  const queue = useQuery({
    queryKey: ["print-queue", storeId],
    queryFn: () => apiFetch<PrintJob[]>(`/api/v1/print-jobs/queue?storeId=${storeId}`),
    enabled: storeId !== "",
    // A fila muda sozinha conforme o tablet imprime.
    refetchInterval: 10_000,
  });

  /**
   * Sugestão de lote: uma etiqueta por peça em estoque na loja. O funcionário
   * ajusta as quantidades antes de mandar — a sugestão é ponto de partida, não
   * decisão.
   */
  const batchSuggestion = useQuery({
    queryKey: ["batch-suggestion", storeId],
    queryFn: () =>
      apiFetch<BatchRow[]>(`/api/v1/print-jobs/batch-suggestion?storeId=${storeId}`),
    enabled: batchOpen && storeId !== "",
  });

  const handleError = (caught: unknown) =>
    setError(caught instanceof ApiError ? caught.message : "Não foi possível concluir.");

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/label-templates", {
        method: "POST",
        body: {
          ...form,
          widthMm: Number(form.widthMm),
          heightMm: Number(form.heightMm),
          gapXMm: Number(form.gapXMm),
          gapYMm: Number(form.gapYMm),
        },
      }),
    onSuccess: () => {
      setError(null);
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ["label-templates"] });
    },
    onError: handleError,
  });

  const sendBatch = useMutation({
    mutationFn: () =>
      apiFetch<{ enfileirados: number; etiquetas: number; problemas: unknown[] }>(
        "/api/v1/print-jobs/labels/batch",
        {
          method: "POST",
          body: {
            storeId,
            ...(modeloDoLote ? { templateId: modeloDoLote } : {}),
            items: (batchSuggestion.data ?? [])
              .map((row) => ({
                productId: row.productId,
                ...(row.variationId ? { variationId: row.variationId } : {}),
                copies: batch[keyOf(row)] ?? row.copies,
              }))
              .filter((item) => item.copies > 0),
          },
        },
      ),
    onSuccess: () => {
      setError(null);
      setBatchOpen(false);
      setBatch({});
      void queryClient.invalidateQueries({ queryKey: ["print-queue"] });
    },
    onError: handleError,
  });

  /**
   * Qual modelo a impressão usa quando ninguém indica outro.
   *
   * Faltava por completo: "usar como padrão" existia só na criação. Quem
   * cadastrasse dois modelos sem marcar nenhum ficava sem padrão para sempre —
   * e a impressão por peça passava a recusar antes de criar o trabalho, o que
   * na tela parece "não está indo para a fila".
   */
  const tornarPadrao = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/label-templates/${id}/default`, { method: "PATCH" }),
    onSuccess: () => {
      setError(null);
      setAviso("Modelo definido como padrão. A impressão por peça passa a usá-lo.");
      void queryClient.invalidateQueries({ queryKey: ["label-templates"] });
    },
    onError: handleError,
  });

  const removeTemplate = useMutation({
    mutationFn: (params: { id: string; reason: string }) =>
      apiFetch<{ mensagem: string }>(`/api/v1/label-templates/${params.id}`, {
        method: "DELETE",
        body: { reason: params.reason },
      }),
    onSuccess: (result) => {
      setError(null);
      setAviso(result.mensagem);
      void queryClient.invalidateQueries({ queryKey: ["label-templates"] });
    },
    onError: handleError,
  });

  /**
   * Relata à fila o que aconteceu com cada etiqueta.
   *
   * O navegador não conta se a impressão saiu — o diálogo fecha do mesmo jeito
   * se a pessoa imprimiu ou cancelou. Por isso quem confirma é o operador: ele
   * olha o rolo e diz. Marcar como impresso sozinho encheria o histórico de
   * etiquetas que nunca existiram.
   */
  const relatarResultado = useMutation({
    mutationFn: async (params: { jobIds: string[]; sucesso: boolean }) => {
      for (const jobId of params.jobIds) {
        await apiFetch(`/api/v1/print-jobs/${jobId}/result`, {
          method: "POST",
          body: {
            success: params.sucesso,
            ...(params.sucesso ? {} : { error: "operador informou que não saiu" }),
          },
        });
      }
    },
    onSuccess: () => {
      setParaImprimir([]);
      void queryClient.invalidateQueries({ queryKey: ["print-queue"] });
    },
    onError: handleError,
  });

  const cancelJob = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/v1/print-jobs/${id}/cancel`, { method: "POST" }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["print-queue"] });
    },
    onError: handleError,
  });

  const toggles: Array<{ key: keyof typeof form; label: string }> = [
    { key: "showProductName", label: "Nome da peça" },
    { key: "showSku", label: "Código" },
    { key: "showPrice", label: "Preço" },
    { key: "showSize", label: "Tamanho" },
    { key: "showWeight", label: "Peso" },
    { key: "showBarcode", label: "Código de barras" },
    { key: "isDoubleSided", label: "Etiqueta dupla (dobra na argola)" },
    { key: "isDefault", label: "Usar como padrão" },
  ];

  return (
    <PageShell
      title="Etiquetas"
      description="Modelos, calibração da impressora e a fila do que está por imprimir."
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setAvulsa((current) => !current);
              setBatchOpen(false);
              setCreating(false);
            }}
          >
            <Printer className="h-5 w-5" aria-hidden />
            Imprimir uma peça
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setBatchOpen((current) => !current);
              setAvulsa(false);
              setCreating(false);
            }}
          >
            <Layers className="h-5 w-5" aria-hidden />
            Imprimir em lote
          </Button>
          {/* Imprimir é do gerente; desenhar o modelo da etiqueta, do dono. */}
          {!creating && can("LABEL_TEMPLATE_MANAGE") && (
            <Button type="button" onClick={() => setCreating(true)}>
              <Tag className="h-5 w-5" aria-hidden />
              Novo modelo
            </Button>
          )}
        </>
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

      {avulsa && (
        <LabelQuickPrint
          storeId={storeId}
          modelos={templates.data ?? []}
          onClose={() => setAvulsa(false)}
        />
      )}

      {/*
        O editor cobre a tela inteira. Desenhar uma etiqueta de 50 mm dentro de
        uma coluna, com a fila de impressão rolando ao lado, seria trabalhar
        pelo buraco da fechadura.

        As medidas chegam como texto porque o banco guarda Decimal e o JSON não
        tem esse tipo — o editor trabalha em número, então a conversão acontece
        aqui, num lugar só.
      */}
      {desenhando && (
        <LabelEditor
          modelo={{
            id: desenhando.id,
            name: desenhando.name,
            widthMm: Number(desenhando.widthMm),
            heightMm: Number(desenhando.heightMm),
            isDoubleSided: desenhando.isDoubleSided,
            elements: desenhando.elements,
          }}
          onClose={() => setDesenhando(null)}
        />
      )}

      {creating && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <fieldset className="mb-5">
            <legend className="mb-2 text-sm font-medium text-text-primary">
              Tamanho do rolo
            </legend>

            <div className="flex flex-wrap gap-2">
              {TAMANHOS_PRONTOS.map((tamanho) => {
                const escolhido =
                  form.widthMm === String(tamanho.larguraMm) &&
                  form.heightMm === String(tamanho.alturaMm);

                return (
                  <Button
                    key={`${tamanho.larguraMm}x${tamanho.alturaMm}`}
                    type="button"
                    variant={escolhido ? "primary" : "outline"}
                    aria-pressed={escolhido}
                    className="flex-col items-start gap-0 py-2 text-left"
                    onClick={() =>
                      setForm({
                        ...form,
                        widthMm: String(tamanho.larguraMm),
                        heightMm: String(tamanho.alturaMm),
                        columnsPerRow: tamanho.colunas,
                        gapXMm: String(tamanho.folgaMm),
                        isDoubleSided: tamanho.dupla,
                      })
                    }
                  >
                    <span className="font-semibold">
                      {tamanho.larguraMm} × {tamanho.alturaMm} mm
                      {tamanho.colunas > 1 ? ` · ${tamanho.colunas} colunas` : ""}
                    </span>
                    <span className="text-sm font-normal opacity-80">{tamanho.para}</span>
                  </Button>
                );
              })}
            </div>

            <p className="mt-2 text-sm text-text-muted">
              Não é nenhum destes? Escreva a medida nos campos abaixo.
            </p>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Código"
              required
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              hint="Ex.: JOIA, PINGENTE."
            />
            <Field
              label="Nome"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <Field
              label="Largura (mm)"
              type="number"
              step="0.5"
              min={5}
              required
              value={form.widthMm}
              onChange={(event) => setForm({ ...form, widthMm: event.target.value })}
              hint="O tamanho do rolo que está na impressora."
            />
            <Field
              label="Altura (mm)"
              type="number"
              step="0.5"
              min={5}
              required
              value={form.heightMm}
              onChange={(event) => setForm({ ...form, heightMm: event.target.value })}
            />
            <Field
              label="Colunas do rolo"
              type="number"
              step="1"
              min={1}
              max={10}
              required
              value={String(form.columnsPerRow)}
              onChange={(event) =>
                setForm({ ...form, columnsPerRow: Math.max(1, Number(event.target.value) || 1) })
              }
              hint="Quantas etiquetas vêm lado a lado. Errar aqui faz sair etiqueta em branco."
            />
            <Field
              label="Folga entre colunas (mm)"
              type="number"
              step="0.1"
              min={0}
              value={form.gapXMm}
              onChange={(event) => setForm({ ...form, gapXMm: event.target.value })}
              hint="O espaço entre uma coluna e a próxima. Zero se elas se encostam."
            />
          </div>

          <fieldset className="mt-5">
            <legend className="mb-2 text-sm font-medium text-text-primary">
              O que aparece impresso
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {toggles.map((toggle) => (
                <label key={toggle.key} className="flex min-h-[44px] items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-rose-primary"
                    checked={Boolean(form[toggle.key])}
                    onChange={(event) =>
                      setForm({ ...form, [toggle.key]: event.target.checked })
                    }
                  />
                  {toggle.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-text-muted">
              Etiqueta de joia é pequena. Marcar tudo costuma sair ilegível — e etiqueta ilegível
              não é lida no PDV.
            </p>
          </fieldset>

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={create.isPending}>
              Salvar modelo
            </Button>
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}


      {batchOpen && (
        <div className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-soft">
          <h2 className="mb-1 font-medium text-text-primary">Imprimir em lote</h2>
          <p className="mb-4 text-sm text-text-secondary">
            Escolha a loja e ajuste a quantidade de cada peça. A sugestão é uma etiqueta por
            peça em estoque.
          </p>

          {!storeId && <Alert tone="info">Escolha a loja no filtro abaixo primeiro.</Alert>}

          {(templates.data?.length ?? 0) > 0 && (
            <div className="mb-4 max-w-sm">
              <label
                className="mb-1 block text-sm font-medium text-text-primary"
                htmlFor="modelo-do-lote"
              >
                Modelo da etiqueta
              </label>
              <select
                id="modelo-do-lote"
                value={modeloDoLote}
                onChange={(event) => setModeloDoLote(event.target.value)}
                className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
              >
                <option value="">Usar o padrão da empresa</option>
                {(templates.data ?? []).map((modelo) => (
                  <option key={modelo.id} value={modelo.id}>
                    {modelo.name} — {modelo.widthMm} × {modelo.heightMm} mm
                  </option>
                ))}
              </select>
            </div>
          )}

          {storeId && (
            <>
              <ul className="mb-4 max-h-96 divide-y divide-border/70 overflow-y-auto">
                {batchSuggestion.data?.map((row) => {
                  const key = keyOf(row);
                  const copies = batch[key] ?? row.copies;

                  return (
                    <li key={key} className="flex items-center justify-between gap-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductPhoto
                          productId={row.productId}
                          checksum={row.imageChecksum}
                          externalUrl={row.imageExternalUrl}
                          alt={row.name}
                          size="sm"
                        />
                        <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-primary">
                          {row.name}
                          {row.size ? ` — tamanho ${row.size}` : ""}
                        </p>
                        <p className="text-sm text-text-secondary">
                          {row.sku} · {formatMoney(row.salePrice)}
                        </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Menos etiquetas de ${row.name}`}
                          onClick={() => setBatch({ ...batch, [key]: Math.max(0, copies - 1) })}
                          className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-text-secondary"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          aria-label={`Etiquetas de ${row.name}`}
                          value={copies}
                          onChange={(event) =>
                            setBatch({ ...batch, [key]: Number(event.target.value) })
                          }
                          className="h-10 w-16 rounded-md border border-border bg-surface text-center text-text-primary"
                        />
                        <button
                          type="button"
                          aria-label={`Mais etiquetas de ${row.name}`}
                          onClick={() => setBatch({ ...batch, [key]: Math.min(100, copies + 1) })}
                          className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-text-secondary"
                        >
                          +
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {batchSuggestion.data?.length === 0 && (
                <Alert tone="info">Nenhuma peça em estoque nesta loja.</Alert>
              )}

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-4">
                <span className="text-sm text-text-secondary">
                  {(batchSuggestion.data ?? []).reduce(
                    (sum, row) => sum + (batch[keyOf(row)] ?? row.copies),
                    0,
                  )}{" "}
                  etiqueta(s) no total
                </span>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    disabled={sendBatch.isPending || (batchSuggestion.data?.length ?? 0) === 0}
                    onClick={() => sendBatch.mutate()}
                  >
                    <Printer className="h-5 w-5" aria-hidden />
                    Mandar para a fila
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setBatchOpen(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <h2 className="mb-3 font-medium text-text-primary">Modelos</h2>
      <ul className="mb-8 space-y-3">
        {templates.data?.map((template) => (
          <li
            key={template.id}
            className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5"
          >
            <div>
              <p className="font-medium text-text-primary">
                {template.name}
                {template.isDefault && (
                  <span className="ml-2 rounded bg-rose-soft px-2 py-0.5 text-sm text-rose-dark">
                    padrão
                  </span>
                )}
              </p>
              <p className="text-sm text-text-secondary">
                {template.code} · {template.widthMm} × {template.heightMm} mm
                {template.isDoubleSided ? " · dupla" : ""}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDesenhando(template);
                  setCreating(false);
                }}
              >
                <PenLine className="h-5 w-5" aria-hidden />
                Desenhar
              </Button>

              {/*
                Só aparece em quem NÃO é o padrão: um botão que já está no
                estado que promete confunde mais do que ajuda.
              */}
              {!template.isDefault && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={tornarPadrao.isPending}
                  onClick={() => tornarPadrao.mutate(template.id)}
                >
                  <Star className="h-5 w-5" aria-hidden />
                  Tornar padrão
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                disabled={removeTemplate.isPending}
                onClick={async () => {
                  const motivo = await confirmar({
                    titulo: `Remover o modelo "${template.name}"?`,
                    descricao:
                      "As etiquetas já impressas continuam valendo. O modelo deixa de aparecer na hora de imprimir.",
                    acao: "Remover",
                    destrutivo: true,
                    pedirMotivo: true,
                  });

                  if (motivo !== null) removeTemplate.mutate({ id: template.id, reason: motivo });
                }}
              >
                <Trash2 className="h-5 w-5" aria-hidden />
                Remover
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {templates.data?.length === 0 && (
        <Alert tone="info">
          Nenhum modelo cadastrado. Sem modelo o sistema não imprime — é melhor recusar que sair
          torto num rolo inteiro.
        </Alert>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-text-primary">Fila de impressão</h2>

        {storeId && (queue.data?.length ?? 0) > 0 && paraImprimir.length === 0 && (
          <Button
            type="button"
            onClick={() => {
              const fila = (queue.data ?? []).filter((job) => job.type === "ETIQUETA");
              setParaImprimir(fila.map((job) => ({
                jobId: job.id,
                copies: job.copies,
                payload: comFormatoDoRolo(job.payload, templates.data ?? []),
              })));

              // O navegador precisa ter a folha montada antes de abrir o
              // diálogo; o próximo quadro garante que o React já pintou.
              requestAnimationFrame(() => window.print());
            }}
          >
            <Printer className="h-5 w-5" aria-hidden />
            Imprimir a fila
          </Button>
        )}
      </div>

      {/*
        Depois do diálogo de impressão, quem confirma é o operador: o navegador
        não conta se o papel saiu, e marcar como impresso sozinho encheria o
        histórico de etiquetas que nunca existiram.
      */}
      {paraImprimir.length > 0 && (
        <div className="mb-4">
          <Alert tone="info" title="Saiu tudo certo?">
            <p className="mb-3">
              Confira o rolo. Se a impressão falhou, as etiquetas continuam na fila para tentar
              de novo.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={relatarResultado.isPending}
                onClick={() =>
                  relatarResultado.mutate({
                    jobIds: paraImprimir.map((label) => label.jobId),
                    sucesso: true,
                  })
                }
              >
                Saiu, pode dar baixa
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={relatarResultado.isPending}
                onClick={() =>
                  relatarResultado.mutate({
                    jobIds: paraImprimir.map((label) => label.jobId),
                    sucesso: false,
                  })
                }
              >
                Não saiu
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => requestAnimationFrame(() => window.print())}
              >
                Imprimir de novo
              </Button>
            </div>
          </Alert>
        </div>
      )}

      <StorePicker storeId={storeId} onChange={setStoreId} className="mb-4 max-w-xs" />

      {storeId && (
        <ul className="space-y-3">
          {queue.data?.map((job) => (
            <li
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5"
            >
              <div className="flex items-start gap-3">
                <Printer className="mt-1 h-5 w-5 text-text-secondary" aria-hidden />
                <div>
                  <p className="font-medium text-text-primary">
                    {job.payload.productName ?? job.type}
                    {job.payload.size ? ` — ${job.payload.size}` : ""}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {job.copies} cópia(s) · {job.payload.sku} ·{" "}
                    {formatMoney(job.payload.price)} · pedida às {formatTime(job.createdAt)}
                  </p>

                  {job.status === "FALHOU" && (
                    <span className="mt-2 inline-flex items-center gap-1 rounded bg-danger/10 px-2 py-0.5 text-sm text-danger">
                      <AlertTriangle className="h-4 w-4" aria-hidden />
                      Não saiu: {job.lastError}
                    </span>
                  )}
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                disabled={cancelJob.isPending}
                onClick={() => cancelJob.mutate(job.id)}
              >
                Cancelar
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/*
        Sem loja escolhida, a seção não mostrava NADA — nem lista, nem aviso.
        Só o título e espaço em branco.

        A fila é por loja, e a etiqueta some da vista de quem está olhando a
        loja errada, ou nenhuma. Isso aparece como "não está indo para a fila"
        quando, na verdade, o trabalho está lá e a tela é que não diz onde
        procurar. Foi exatamente o que aconteceu: a etiqueta estava enfileirada
        no Quiosque Elis Maas e a tela mostrava vazio.
      */}
      {!storeId && (
        <Alert tone="info">
          Escolha a loja acima para ver a fila. Cada loja tem a sua — a etiqueta vai para a
          impressora da loja onde foi pedida.
        </Alert>
      )}

      {storeId && queue.data?.length === 0 && (
        <Alert tone="success">Nada esperando impressão nesta loja.</Alert>
      )}

      {/* Fora da tela; só existe durante a impressão. */}
      <LabelSheet labels={paraImprimir} />
    </PageShell>
  );
}
