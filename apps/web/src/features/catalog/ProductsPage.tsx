import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";

interface Variation {
  id: string;
  sku: string;
  size: string | null;
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
  category: { name: string } | null;
  variations: Variation[];
}

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
  const [error, setError] = useState<string | null>(null);

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

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/v1/products", {
        method: "POST",
        body: {
          sku: form.sku.trim(),
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

  return (
    <PageShell
      title="Produtos"
      description="O catálogo vale para todas as lojas. O que muda de loja para loja é o estoque."
      actions={
        adding ? null : (
          <Button type="button" onClick={() => setAdding(true)}>
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

      {adding && (
        <form
          className="mb-6 rounded-lg border border-border bg-surface p-5"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Código (SKU)"
              required
              value={form.sku}
              onChange={(event) => setForm({ ...form, sku: event.target.value.toUpperCase() })}
              hint="É o que vai na etiqueta. Ex.: AN-001."
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

            {selectedGrade && (
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

          <div className="mt-5 flex gap-3">
            <Button type="submit" disabled={create.isPending}>
              Cadastrar
            </Button>
            <Button type="button" variant="outline" onClick={() => setAdding(false)}>
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
              <div className="flex items-start gap-3">
                <Package className="mt-1 h-5 w-5 text-text-secondary" aria-hidden />
                <div>
                  <p className="font-medium text-text-primary">{product.name}</p>
                  <p className="text-sm text-text-secondary">
                    {product.sku}
                    {product.category ? ` · ${product.category.name}` : ""}
                    {product.weightGrams ? ` · ${product.weightGrams} g` : ""}
                  </p>

                  {product.hasVariations && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {product.variations.map((variation) => (
                        <span
                          key={variation.id}
                          className="rounded bg-background-secondary px-2 py-0.5 text-sm text-text-secondary"
                        >
                          {variation.size}
                        </span>
                      ))}
                    </div>
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
              </div>
            </div>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
