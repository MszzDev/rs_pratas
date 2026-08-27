import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Package } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { apiFetch } from "@/lib/api-client";

interface LinhaDaRede {
  productId: string;
  sku: string;
  name: string;
  size: string | null;
  salePrice: string;
  total: number;
  disponivel: number;
  reservado: number;
  abaixoDoMinimo: boolean;
  lojas: { storeId: string; storeName: string; quantidade: number; disponivel: number }[];
}

/**
 * O estoque da rede, uma linha por peça.
 *
 * A tela de Estoque sempre mostrou uma loja de cada vez, o que responde "o que
 * tem aqui?". Não responde a pergunta do dono: "quantos a rede tem, e onde
 * eles estão?" — que exigia abrir a mesma tela cinco vezes e somar de cabeça.
 *
 * A divisão por loja fica escondida até alguém tocar. Cinco lojas × centenas
 * de peças, tudo aberto de uma vez, é uma parede de números onde não se acha
 * nada; fechada, a lista responde primeiro o total, que é a pergunta mais
 * frequente.
 */
export function NetworkStock({ search, lowOnly }: { search: string; lowOnly: boolean }) {
  const [aberta, setAberta] = useState<string | null>(null);

  const rede = useQuery({
    queryKey: ["stock-rede", search, lowOnly],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (lowOnly) params.set("lowStockOnly", "true");
      return apiFetch<LinhaDaRede[]>(`/api/v1/stock/summary?${params.toString()}`);
    },
  });

  if (rede.isPending) {
    return <p className="text-sm text-text-muted">Somando as lojas...</p>;
  }

  const linhas = rede.data ?? [];

  if (linhas.length === 0) {
    return (
      <Alert tone="info">
        {search ? "Nenhuma peça com esse nome ou código." : "Nenhuma peça no estoque ainda."}
      </Alert>
    );
  }

  const totalDePecas = linhas.reduce((soma, linha) => soma + linha.total, 0);
  const semNenhuma = linhas.filter((linha) => linha.total === 0).length;

  return (
    <>
      <p className="mb-4 text-sm text-text-secondary">
        {linhas.length} peça(s) no catálogo · {totalDePecas} unidade(s) na rede
        {semNenhuma > 0 && (
          <>
            {" · "}
            <span className="text-text-muted">{semNenhuma} ainda sem nenhuma contada</span>
          </>
        )}
      </p>

      <ul className="space-y-2">
        {linhas.map((linha) => {
          const chave = `${linha.productId}:${linha.size ?? ""}`;
          const expandida = aberta === chave;

          return (
            <li key={chave} className="rounded-lg border border-border bg-surface">
              <button
                type="button"
                aria-expanded={expandida}
                onClick={() => setAberta(expandida ? null : chave)}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-background-secondary"
              >
                {expandida ? (
                  <ChevronDown className="h-5 w-5 shrink-0 text-text-muted" aria-hidden />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-text-muted" aria-hidden />
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text-primary">
                    {linha.name}
                    {linha.size && <span className="text-text-muted"> · {linha.size}</span>}
                  </span>
                  <span className="block text-sm text-text-muted">{linha.sku}</span>
                </span>

                <span className="shrink-0 text-right">
                  <span
                    className={`block text-2xl font-semibold ${
                      linha.total === 0 ? "text-text-muted" : "text-text-primary"
                    }`}
                  >
                    {linha.total}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {linha.total === 1 ? "peça na rede" : "peças na rede"}
                  </span>
                </span>
              </button>

              {expandida && (
                <div className="border-t border-border px-4 py-3">
                  <ul className="space-y-1.5">
                    {linha.lojas.map((loja) => (
                      <li
                        key={loja.storeId}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="flex items-center gap-2 text-text-secondary">
                          <Package className="h-4 w-4 text-text-muted" aria-hidden />
                          {loja.storeName}
                        </span>
                        <span
                          className={
                            loja.quantidade === 0 ? "text-text-muted" : "text-text-primary"
                          }
                        >
                          {loja.quantidade}
                          {/*
                            O reservado só aparece quando existe: repetir
                            "0 reservadas" em cada linha faria a informação
                            que importa se perder no meio das que não.
                          */}
                          {loja.quantidade !== loja.disponivel && (
                            <span className="text-text-muted">
                              {" "}
                              ({loja.disponivel} livre
                              {loja.disponivel === 1 ? "" : "s"})
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {linha.reservado > 0 && (
                    <p className="mt-3 border-t border-border pt-2 text-sm text-text-muted">
                      {linha.reservado} peça(s) separada(s) para clientes — não estão à venda.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
