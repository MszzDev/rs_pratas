import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";
import { ProductPhoto } from "@/components/ui/product-photo";

/**
 * Imprimir a etiqueta de UMA peça.
 *
 * O lote resolve a virada de estoque — chegou a remessa, imprime tudo. Não
 * resolve o dia a dia: a etiqueta que caiu da argola, a peça que voltou da
 * vitrine sem preço, o cliente que pediu para trocar o tamanho. Mandar o lote
 * inteiro por causa de uma peça gasta rolo e ainda deixa etiquetas soltas no
 * balcão, que é justamente como uma peça acaba com dois preços colados.
 *
 * A rota que enfileira uma peça já existia desde o começo; o que faltava era
 * uma tela chamando ela.
 */

interface Variacao {
  id: string;
  sku: string;
  size: string | null;
}

interface Produto {
  id: string;
  sku: string;
  name: string;
  salePrice: string | null;
  imageChecksum: string | null;
  imageExternalUrl: string | null;
  hasVariations: boolean;
  variations: Variacao[];
}

export function LabelQuickPrint({
  storeId,
  templateId,
  onClose,
}: {
  storeId: string;
  templateId?: string | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<Produto | null>(null);
  const [variacaoId, setVariacaoId] = useState<string | null>(null);
  const [copias, setCopias] = useState(1);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState<string | null>(null);

  /**
   * Só busca a partir de duas letras. Uma letra traria o catálogo inteiro a
   * cada tecla, e num tablet na rede da loja isso é meio segundo de espera por
   * caractere digitado.
   */
  const produtos = useQuery({
    queryKey: ["products", busca],
    queryFn: () =>
      apiFetch<Produto[]>(`/api/v1/products?search=${encodeURIComponent(busca)}`),
    enabled: busca.trim().length >= 2,
  });

  const enfileirar = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/api/v1/print-jobs/labels", {
        method: "POST",
        body: {
          storeId,
          productId: escolhido?.id,
          ...(variacaoId ? { variationId: variacaoId } : {}),
          ...(templateId ? { templateId } : {}),
          copies: copias,
        },
      }),
    onSuccess: () => {
      setErro(null);
      setPronto(
        `${copias} ${copias === 1 ? "etiqueta foi" : "etiquetas foram"} para a fila.`,
      );
      setEscolhido(null);
      setVariacaoId(null);
      setCopias(1);
      setBusca("");
      void queryClient.invalidateQueries({ queryKey: ["print-queue"] });
    },
    onError: (caught) =>
      setErro(
        caught instanceof ApiError ? caught.message : "Não foi possível mandar para a fila.",
      ),
  });

  // Peça com tamanho é uma etiqueta por tamanho: o preço pode ser o mesmo, mas
  // o código de barras não é, e é ele que o caixa lê.
  const precisaEscolherTamanho =
    escolhido !== null && escolhido.hasVariations && escolhido.variations.length > 0;

  return (
    <div className="mb-8 rounded-lg border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-text-primary">Imprimir uma peça</h2>
        <Button type="button" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>

      {erro && (
        <div className="mb-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}
      {pronto && (
        <div className="mb-4">
          <Alert tone="success">{pronto}</Alert>
        </div>
      )}

      {storeId === "" ? (
        <Alert tone="info">
          Escolha a loja primeiro — a etiqueta vai para a fila da impressora daquela loja.
        </Alert>
      ) : escolhido === null ? (
        <>
          <Field
            label="Procurar a peça"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="nome ou código"
            hint={
              <span className="inline-flex items-center gap-1">
                <Search className="h-4 w-4" aria-hidden />
                Digite ao menos duas letras.
              </span>
            }
          />

          {produtos.isFetching && (
            <p className="mt-3 text-sm text-text-muted">Procurando...</p>
          )}

          {produtos.data && produtos.data.length === 0 && (
            <p className="mt-3 text-sm text-text-muted">Nenhuma peça com esse nome ou código.</p>
          )}

          <ul className="mt-3 space-y-2">
            {produtos.data?.slice(0, 12).map((produto) => (
              <li key={produto.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md border border-border p-3 text-left hover:bg-background-secondary"
                  onClick={() => {
                    setPronto(null);
                    setEscolhido(produto);
                    setVariacaoId(
                      produto.variations.length === 1 && produto.variations[0]
                        ? produto.variations[0].id
                        : null,
                    );
                  }}
                >
                  <ProductPhoto
                    productId={produto.id}
                    checksum={produto.imageChecksum}
                    externalUrl={produto.imageExternalUrl}
                    alt={produto.name}
                    size="sm"
                  />
                  <span>
                    <span className="block font-medium text-text-primary">{produto.name}</span>
                    <span className="block text-sm text-text-secondary">{produto.sku}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <ProductPhoto
              productId={escolhido.id}
              checksum={escolhido.imageChecksum}
              externalUrl={escolhido.imageExternalUrl}
              alt={escolhido.name}
              size="md"
            />
            <div>
              <p className="font-medium text-text-primary">{escolhido.name}</p>
              <p className="text-sm text-text-secondary">{escolhido.sku}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                setEscolhido(null);
                setVariacaoId(null);
              }}
            >
              Trocar peça
            </Button>
          </div>

          {precisaEscolherTamanho && (
            <div className="mb-4">
              <p className="mb-2 text-sm font-medium text-text-secondary">Tamanho</p>
              <div className="flex flex-wrap gap-2">
                {escolhido.variations.map((variacao) => (
                  <Button
                    key={variacao.id}
                    type="button"
                    variant={variacaoId === variacao.id ? "primary" : "outline"}
                    aria-pressed={variacaoId === variacao.id}
                    onClick={() => setVariacaoId(variacao.id)}
                  >
                    {variacao.size ?? variacao.sku}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="mb-4">
            <p className="mb-2 text-sm font-medium text-text-secondary">Quantas etiquetas</p>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="uma a menos"
                onClick={() => setCopias((n) => Math.max(1, n - 1))}
              >
                <Minus className="h-5 w-5" aria-hidden />
              </Button>

              <input
                type="number"
                min={1}
                max={100}
                aria-label="quantidade de etiquetas"
                value={copias}
                onChange={(evento) => {
                  // O limite é o mesmo do servidor. Deixar digitar 500 aqui só
                  // adiaria a recusa para depois do toque em imprimir.
                  const valor = Number(evento.target.value);
                  setCopias(Number.isFinite(valor) ? Math.min(100, Math.max(1, valor)) : 1);
                }}
                className="min-h-[48px] w-24 rounded-md border border-border bg-surface px-4 text-center text-base text-text-primary outline-none focus:border-rose-primary focus:ring-2 focus:ring-rose-soft"
              />

              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="uma a mais"
                onClick={() => setCopias((n) => Math.min(100, n + 1))}
              >
                <Plus className="h-5 w-5" aria-hidden />
              </Button>
            </div>
          </div>

          <Button
            type="button"
            disabled={enfileirar.isPending || (precisaEscolherTamanho && variacaoId === null)}
            onClick={() => enfileirar.mutate()}
          >
            <Printer className="h-5 w-5" aria-hidden />
            {enfileirar.isPending ? "Mandando..." : "Mandar para a fila"}
          </Button>

          {precisaEscolherTamanho && variacaoId === null && (
            <p className="mt-2 text-sm text-text-muted">
              Escolha o tamanho — cada um tem seu próprio código de barras.
            </p>
          )}
        </>
      )}
    </div>
  );
}
