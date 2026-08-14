import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Crosshair, Printer, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";

interface Template {
  id: string;
  code: string;
  name: string;
  widthMm: string;
  heightMm: string;
  offsetXMm: string;
  offsetYMm: string;
  isDoubleSided: boolean;
  showProductName: boolean;
  showSku: boolean;
  showPrice: boolean;
  showWeight: boolean;
  showSize: boolean;
  showBarcode: boolean;
  isDefault: boolean;
}

interface PrintJob {
  id: string;
  type: string;
  status: string;
  copies: number;
  lastError: string | null;
  createdAt: string;
  payload: {
    productName: string | null;
    sku: string | null;
    price: string | null;
    size: string | null;
  };
}

interface StoreRow {
  id: string;
  name: string;
}

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
  const queryClient = useQueryClient();
  const [storeId, setStoreId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [calibrating, setCalibrating] = useState<Template | null>(null);

  const [form, setForm] = useState({
    code: "",
    name: "",
    widthMm: "50",
    heightMm: "12",
    isDoubleSided: true,
    showProductName: true,
    showSku: true,
    showPrice: true,
    showWeight: false,
    showSize: true,
    showBarcode: true,
    isDefault: false,
  });

  const [offsetX, setOffsetX] = useState("0");
  const [offsetY, setOffsetY] = useState("0");

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<StoreRow[]>("/api/v1/stores"),
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
        },
      }),
    onSuccess: () => {
      setError(null);
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ["label-templates"] });
    },
    onError: handleError,
  });

  const calibrate = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/label-templates/${calibrating?.id}/calibration`, {
        method: "PATCH",
        body: { offsetXMm: Number(offsetX), offsetYMm: Number(offsetY) },
      }),
    onSuccess: () => {
      setError(null);
      setCalibrating(null);
      void queryClient.invalidateQueries({ queryKey: ["label-templates"] });
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
        creating ? null : (
          <Button type="button" onClick={() => setCreating(true)}>
            <Tag className="h-5 w-5" aria-hidden />
            Novo modelo
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {creating && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
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

      {calibrating && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            calibrate.mutate();
          }}
        >
          <h2 className="mb-1 font-medium text-text-primary">Calibrar {calibrating.name}</h2>
          <p className="mb-4 text-sm text-text-secondary">
            Imprima uma etiqueta de teste. Se sair para a esquerda, aumente o horizontal; se sair
            para cima, aumente o vertical.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Deslocamento horizontal (mm)"
              type="number"
              step="0.5"
              value={offsetX}
              onChange={(event) => setOffsetX(event.target.value)}
            />
            <Field
              label="Deslocamento vertical (mm)"
              type="number"
              step="0.5"
              value={offsetY}
              onChange={(event) => setOffsetY(event.target.value)}
            />
          </div>

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={calibrate.isPending}>
              Salvar ajuste
            </Button>
            <Button type="button" variant="outline" onClick={() => setCalibrating(null)}>
              Cancelar
            </Button>
          </div>
        </form>
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
                {Number(template.offsetXMm) !== 0 || Number(template.offsetYMm) !== 0
                  ? ` · ajuste ${template.offsetXMm}/${template.offsetYMm} mm`
                  : ""}
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCalibrating(template);
                setOffsetX(template.offsetXMm);
                setOffsetY(template.offsetYMm);
                setCreating(false);
              }}
            >
              <Crosshair className="h-5 w-5" aria-hidden />
              Calibrar
            </Button>
          </li>
        ))}
      </ul>

      {templates.data?.length === 0 && (
        <Alert tone="info">
          Nenhum modelo cadastrado. Sem modelo o sistema não imprime — é melhor recusar que sair
          torto num rolo inteiro.
        </Alert>
      )}

      <h2 className="mb-3 font-medium text-text-primary">Fila de impressão</h2>

      <div className="mb-4 max-w-xs">
        <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="loja">
          Loja
        </label>
        <select
          id="loja"
          value={storeId}
          onChange={(event) => setStoreId(event.target.value)}
          className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
        >
          <option value="">Selecione</option>
          {stores.data?.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </div>

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

      {storeId && queue.data?.length === 0 && (
        <Alert tone="success">Nada esperando impressão nesta loja.</Alert>
      )}
    </PageShell>
  );
}
