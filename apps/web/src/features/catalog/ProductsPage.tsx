import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ProductPhoto } from "@/components/ui/product-photo";

interface Variation {
  id: string;
  sku: string;
  size: string | null;
  stockItems: Array<{ quantity: number; reservedQuantity: number }>;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  material: string;
  weightGrams: string | null;
  costPrice: string | null;
  salePrice: string | null;
  hasVariations: boolean;
  isActive: boolean;
  /** Nulo = sem foto. Também é a chave de cache da imagem. */
  imageChecksum: string | null;
  category: { name: string } | null;
  variations: Variation[];
  stockItems: Array<{ quantity: number; reservedQuantity: number }>;
}

/** Soma o disponível de todas as lojas — é o número da rede, não de uma loja. */
const disponivel = (items: Array<{ quantity: number; reservedQuantity: number }>) =>
  items.reduce((total, item) => total + item.quantity - item.reservedQuantity, 0);

interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

interface SizeGrade {
  id: string;
  name: string;
  sizes: string[];
}

/**
 * Valores monetários chegam como string (Decimal) e podem vir `null` quando o
 * perfil é DESENVOLVEDOR — o mascaramento acontece no servidor. A tela precisa
 * lidar com isso sem quebrar.
 */
const formatMoney = (value: string | null) =>
  value === null ? "—" : Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Tamanhos que o produto em edição ainda pode ganhar. */
  const [novosTamanhos, setNovosTamanhos] = useState<string[]>([]);

  const [form, setForm] = useState({
    sku: "",
    name: "",
    categoryId: "",
    sizeGradeId: "",
    weightGrams: "",
    costPrice: "",
    salePrice: "",
  });
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);

  const products = useQuery({
    queryKey: ["products", search],
    queryFn: () =>
      apiFetch<Product[]>(
        search ? `/api/v1/products?search=${encodeURIComponent(search)}` : "/api/v1/products",
      ),
  });

  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<Category[]>("/api/v1/categories"),
  });

  const grades = useQuery({
    queryKey: ["size-grades"],
    queryFn: () => apiFetch<SizeGrade[]>("/api/v1/size-grades"),
  });

  const selectedGrade = grades.data?.find((grade) => grade.id === form.sizeGradeId);

  /**
   * Código sugerido pelo sistema, atualizado conforme a categoria muda.
   *
   * Quem cadastra peça no balcão inventa o padrão que lembra na hora, e em
   * três meses o catálogo tem "AN1", "an-002" e "ANEL 3" apontando para coisas
   * parecidas. O sugerido é previsível e não colide — mas continua editável,
   * porque loja que já tem numeração própria não deveria ser obrigada a mudar.
   */
  const sugestaoSku = useQuery({
    queryKey: ["next-sku", form.categoryId],
    queryFn: () =>
      apiFetch<{ sku: string }>(
        `/api/v1/products/next-sku${form.categoryId ? `?categoryId=${form.categoryId}` : ""}`,
      ),
    enabled: adding,
  });

  /**
   * Envio da foto. Multipart, e a validação de verdade é no servidor: o
   * `accept` do input só filtra o que o seletor de arquivos mostra.
   */
  const enviarFoto = useMutation({
    mutationFn: async (params: { productId: string; file: File }) => {
      const form = new FormData();
      form.append("file", params.file);
      return apiFetch(`/api/v1/products/${params.productId}/image`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível enviar a foto."),
  });

  const removerFoto = useMutation({
    mutationFn: (productId: string) =>
      apiFetch(`/api/v1/products/${productId}/image`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível remover a foto."),
  });

  const editar = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/products/${editingId}`, {
        method: "PATCH",
        body: {
          name: form.name.trim(),
          costPrice: Number(form.costPrice),
          salePrice: Number(form.salePrice),
          ...(form.categoryId ? { categoryId: form.categoryId } : {}),
          ...(form.weightGrams ? { weightGrams: Number(form.weightGrams) } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      fecharFormulario();
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível salvar."),
  });

  /** Acrescenta tamanhos a um produto que já existe — a loja passou a girar o 30. */
  const adicionarTamanhos = useMutation({
    mutationFn: (productId: string) =>
      apiFetch(`/api/v1/products/${productId}/variations`, {
        method: "POST",
        body: { sizes: novosTamanhos },
      }),
    onSuccess: () => {
      setError(null);
      setNovosTamanhos([]);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível adicionar."),
  });

  const ativar = useMutation({
    mutationFn: (params: { id: string; ativo: boolean }) =>
      params.ativo
        ? apiFetch(`/api/v1/products/${params.id}`, { method: "PATCH", body: { isActive: true } })
        : apiFetch<{ id: string }>(`/api/v1/products/${params.id}/deactivate`, {
            method: "POST",
            body: { reason: "retirado do mostruário" },
          }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível concluir."),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/products", {
        method: "POST",
        body: {
          // Vazio deixa o servidor gerar o próximo da categoria.
          ...(form.sku.trim() ? { sku: form.sku.trim() } : {}),
          name: form.name.trim(),
          costPrice: Number(form.costPrice),
          salePrice: Number(form.salePrice),
          ...(form.categoryId ? { categoryId: form.categoryId } : {}),
          ...(form.sizeGradeId ? { sizeGradeId: form.sizeGradeId } : {}),
          ...(form.weightGrams ? { weightGrams: Number(form.weightGrams) } : {}),
          ...(selectedSizes.length > 0 ? { sizes: selectedSizes } : {}),
        },
      }),
    onSuccess: () => {
      setError(null);
      setAdding(false);
      setForm({
        sku: "",
        name: "",
        categoryId: "",
        sizeGradeId: "",
        weightGrams: "",
        costPrice: "",
        salePrice: "",
      });
      setSelectedSizes([]);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível cadastrar."),
  });

  function fecharFormulario() {
    setAdding(false);
    setEditingId(null);
    setSelectedSizes([]);
    setNovosTamanhos([]);
    setForm({
      sku: "",
      name: "",
      categoryId: "",
      sizeGradeId: "",
      weightGrams: "",
      costPrice: "",
      salePrice: "",
    });
  }

  function abrirEdicao(product: Product) {
    setEditingId(product.id);
    setAdding(false);
    setNovosTamanhos([]);
    setForm({
      // O SKU não é editável: ele já está impresso nas etiquetas das peças na
      // vitrine, e trocá-lo faria a leitura no PDV parar de encontrar a peça.
      sku: product.sku,
      name: product.name,
      categoryId: "",
      sizeGradeId: "",
      weightGrams: product.weightGrams ?? "",
      costPrice: product.costPrice ?? "",
      salePrice: product.salePrice ?? "",
    });
  }

  const produtoEmEdicao = products.data?.find((product) => product.id === editingId);
  const formularioAberto = adding || editingId !== null;

  return (
    <PageShell
      eyebrow="Catálogo"
      title="Produtos"
      description="O catálogo vale para todas as lojas. O que muda de loja para loja é o estoque."
      actions={
        formularioAberto ? null : (
          <Button
            type="button"
            onClick={() => {
              fecharFormulario();
              setAdding(true);
            }}
          >
            <Plus className="h-5 w-5" aria-hidden />
            Novo produto
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

      {formularioAberto && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5 shadow-soft"
          onSubmit={(event) => {
            event.preventDefault();
            if (editingId) editar.mutate();
            else create.mutate();
          }}
        >
          <h2 className="mb-4 font-medium text-text-primary">
            {editingId ? `Editar ${produtoEmEdicao?.name ?? "produto"}` : "Novo produto"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Código (SKU)"
              disabled={editingId !== null}
              value={form.sku}
              onChange={(event) => setForm({ ...form, sku: event.target.value.toUpperCase() })}
              placeholder={sugestaoSku.data?.sku ?? ""}
              hint={
                editingId
                  ? "Não muda: já está impresso nas etiquetas das peças na vitrine."
                  : sugestaoSku.data
                    ? `Deixe vazio para usar ${sugestaoSku.data.sku}, que o sistema gerou.`
                    : "É o que vai na etiqueta."
              }
            />
            <Field
              label="Nome"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />

            <div>
              <label
                className="mb-1 block text-sm font-medium text-text-primary"
                htmlFor="categoria"
              >
                Categoria
              </label>
              <select
                id="categoria"
                value={form.categoryId}
                onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
              >
                <option value="">Sem categoria</option>
                {categories.data?.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Peso (gramas)"
              type="number"
              step="0.001"
              min={0}
              value={form.weightGrams}
              onChange={(event) => setForm({ ...form, weightGrams: event.target.value })}
              hint="Prata é vendida por peso — vale registrar."
            />

            <Field
              label="Custo (R$)"
              type="number"
              step="0.01"
              min={0}
              required
              value={form.costPrice}
              onChange={(event) => setForm({ ...form, costPrice: event.target.value })}
            />
            <Field
              label="Preço de venda (R$)"
              type="number"
              step="0.01"
              min={0}
              required
              value={form.salePrice}
              onChange={(event) => setForm({ ...form, salePrice: event.target.value })}
            />

            {!editingId && (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-text-primary" htmlFor="grade">
                Grade de tamanhos
              </label>
              <select
                id="grade"
                value={form.sizeGradeId}
                onChange={(event) => {
                  setForm({ ...form, sizeGradeId: event.target.value });
                  setSelectedSizes([]);
                }}
                className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
              >
                <option value="">Sem tamanho (pingente, corrente pronta)</option>
                {grades.data?.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </select>
            </div>
            )}

            {!editingId && selectedGrade && (
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium text-text-primary">
                  Tamanhos que a loja trabalha
                </legend>
                <div className="flex flex-wrap gap-2">
                  {selectedGrade.sizes.map((size) => {
                    const checked = selectedSizes.includes(size);
                    return (
                      <label
                        key={size}
                        className={`flex min-h-[44px] min-w-[56px] cursor-pointer items-center justify-center rounded-md border px-3 ${
                          checked
                            ? "border-rose-primary bg-rose-soft text-rose-dark"
                            : "border-border text-text-secondary"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          onChange={(event) =>
                            setSelectedSizes((current) =>
                              event.target.checked
                                ? [...current, size]
                                : current.filter((item) => item !== size),
                            )
                          }
                        />
                        {size}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-sm text-text-muted">
                  Cada tamanho vira um item próprio no estoque. Marque só os que existem de verdade.
                </p>
              </fieldset>
            )}
          </div>

          {/* Em edição, acrescentar tamanhos é ato próprio: o produto já tem
              estoque nos tamanhos antigos, e recriar a lista os apagaria. */}
          {editingId && produtoEmEdicao?.hasVariations && (
            <fieldset className="mt-5 border-t border-border/70 pt-5">
              <legend className="sr-only">Acrescentar tamanhos</legend>
              <p className="mb-2 text-sm font-medium text-text-primary">
                Tamanhos já cadastrados
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {produtoEmEdicao.variations.map((variation) => (
                  <span
                    key={variation.id}
                    className="rounded bg-background-secondary px-2 py-0.5 text-sm text-text-secondary"
                  >
                    {variation.size}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <Field
                    label="Novo tamanho"
                    value={novosTamanhos.join(", ")}
                    onChange={(event) =>
                      setNovosTamanhos(
                        event.target.value
                          .split(",")
                          .map((size) => size.trim())
                          .filter(Boolean),
                      )
                    }
                    hint="Separe por vírgula."
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={novosTamanhos.length === 0 || adicionarTamanhos.isPending}
                  onClick={() => adicionarTamanhos.mutate(editingId)}
                >
                  Acrescentar
                </Button>
              </div>
            </fieldset>
          )}

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={create.isPending || editar.isPending}>
              {editingId ? "Salvar alterações" : "Cadastrar"}
            </Button>
            <Button type="button" variant="outline" onClick={fecharFormulario}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      <div className="mb-5 max-w-md">
        <Field
          label="Buscar"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nome, código ou código de barras"
        />
      </div>

      {products.data?.length === 0 && (
        <Alert tone="info">
          <span className="flex items-center gap-2">
            <Search className="h-4 w-4" aria-hidden />
            Nenhum produto encontrado.
          </span>
        </Alert>
      )}

      <ul className="space-y-3">
        {products.data?.map((product) => (
          <li key={product.id} className="rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <ProductPhoto
                  productId={product.id}
                  checksum={product.imageChecksum}
                  alt={product.name}
                  size="lg"
                />
                <div>
                  <p className="font-medium text-text-primary">{product.name}</p>
                  <p className="text-sm text-text-secondary">
                    {product.sku}
                    {product.category ? ` · ${product.category.name}` : ""}
                    {product.weightGrams ? ` · ${product.weightGrams} g` : ""}
                  </p>

                  {product.hasVariations ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {product.variations.map((variation) => {
                        const saldo = disponivel(variation.stockItems);
                        return (
                          <span
                            key={variation.id}
                            title={`${saldo} disponível(is) na rede`}
                            className={`rounded px-2 py-0.5 text-sm ${
                              saldo > 0
                                ? "bg-rose-soft text-rose-dark"
                                : "bg-background-secondary text-text-muted line-through"
                            }`}
                          >
                            {/* O separador não é enfeite: "16" com "5" colado
                                do lado vira "165" e o tamanho some. */}
                            {variation.size}
                            <span className="mx-1 opacity-40">·</span>
                            <span className="text-xs opacity-70">{saldo}</span>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-text-secondary">
                      {disponivel(product.stockItems)} disponível(is) na rede
                    </p>
                  )}
                </div>
              </div>

              <div className="text-right">
                <p className="font-medium text-text-primary">{formatMoney(product.salePrice)}</p>
                <p className="text-sm text-text-muted">custo {formatMoney(product.costPrice)}</p>
                {!product.isActive && (
                  <span className="mt-1 inline-block rounded bg-border px-2 py-0.5 text-sm text-text-muted">
                    Inativo
                  </span>
                )}

                <div className="mt-2 flex flex-wrap justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => abrirEdicao(product)}
                    className="flex min-h-[36px] items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary hover:bg-background-secondary"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    Editar
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAviso(null);
                      ativar.mutate({ id: product.id, ativo: !product.isActive });
                    }}
                    className="flex min-h-[36px] items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary hover:bg-background-secondary"
                  >
                    <Power className="h-4 w-4" aria-hidden />
                    {product.isActive ? "Desativar" : "Reativar"}
                  </button>

                  <label className="flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary hover:bg-background-secondary">
                    <ImagePlus className="h-4 w-4" aria-hidden />
                    {product.imageChecksum ? "Trocar foto" : "Adicionar foto"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) enviarFoto.mutate({ productId: product.id, file });
                        event.target.value = "";
                      }}
                    />
                  </label>

                  {product.imageChecksum && (
                    <button
                      type="button"
                      aria-label={`Remover foto de ${product.name}`}
                      onClick={() => removerFoto.mutate(product.id)}
                      className="flex min-h-[36px] items-center rounded-md px-2 text-text-muted hover:bg-background-secondary"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
