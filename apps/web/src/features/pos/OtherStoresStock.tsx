import { useQuery } from "@tanstack/react-query";
import { MapPin, Phone } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";

interface LinhaDeOutraLoja {
  productId: string;
  name: string;
  sku: string;
  size: string | null;
  salePrice: string;
  storeId: string;
  storeName: string;
  storePhone: string | null;
  disponivel: number;
}

/**
 * "Não tem aqui — mas tem ali."
 *
 * Aparece quando a busca não achou nada na loja onde o caixa está aberto, que
 * é exatamente o instante em que a venda estava prestes a ser perdida. Antes
 * disso a vendedora só tinha o pedido manual, com dias de espera, para uma
 * peça que podia estar a seis quilômetros dali.
 *
 * Mostra o telefone da loja junto de propósito: a ação seguinte é ligar e
 * pedir para separar, e procurar o número em outra tela é onde a intenção
 * morre.
 *
 * O que NÃO faz: reservar sozinha. A peça está na gaveta de outra loja, com
 * outra vendedora podendo vendê-la neste segundo — prometer ao cliente sem
 * alguém do outro lado confirmar seria criar o problema no lugar de resolver.
 */
export function OtherStoresStock({ search, storeId }: { search: string; storeId: string }) {
  const termo = search.trim();

  const outras = useQuery({
    queryKey: ["stock-outras-lojas", termo, storeId],
    queryFn: () =>
      apiFetch<LinhaDeOutraLoja[]>(
        `/api/v1/stock/other-stores?search=${encodeURIComponent(termo)}&exceptStoreId=${storeId}`,
      ),
    enabled: termo.length >= 2 && storeId !== "",
  });

  if (termo.length < 2) return null;

  if (outras.isPending) {
    return <p className="mt-3 text-sm text-text-muted">Procurando nas outras lojas...</p>;
  }

  const linhas = outras.data ?? [];

  if (linhas.length === 0) {
    return (
      <p className="mt-3 text-sm text-text-muted">
        Também não há esta peça nas outras lojas. Dá para abrir um pedido em Solicitar Peça.
      </p>
    );
  }

  // Agrupa por loja: a vendedora vai ligar para UMA loja, então é por loja que
  // a informação precisa estar organizada — não por peça.
  const porLoja = new Map<string, { nome: string; telefone: string | null; itens: LinhaDeOutraLoja[] }>();

  for (const linha of linhas) {
    const atual = porLoja.get(linha.storeId) ?? {
      nome: linha.storeName,
      telefone: linha.storePhone,
      itens: [],
    };
    atual.itens.push(linha);
    porLoja.set(linha.storeId, atual);
  }

  return (
    <div className="mt-4">
      <Alert tone="success" title="Tem em outra loja">
        <p className="text-sm">
          Ligue e peça para separar. A peça só é sua depois que alguém de lá confirmar.
        </p>
      </Alert>

      <ul className="mt-3 space-y-3">
        {[...porLoja.entries()].map(([id, loja]) => (
          <li key={id} className="rounded-md border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-medium text-text-primary">
                <MapPin className="h-4 w-4 text-gold-dark" aria-hidden />
                {loja.nome}
              </p>

              {loja.telefone && (
                <a
                  href={`tel:${loja.telefone.replace(/\D/g, "")}`}
                  className="flex items-center gap-1.5 text-sm font-medium text-gold-dark underline-offset-2 hover:underline"
                >
                  <Phone className="h-4 w-4" aria-hidden />
                  {loja.telefone}
                </a>
              )}
            </div>

            <ul className="mt-2 space-y-1">
              {loja.itens.map((item) => (
                <li
                  key={`${item.storeId}-${item.sku}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                >
                  <span className="text-text-secondary">
                    {item.name}
                    {item.size && <span className="text-text-muted"> · {item.size}</span>}
                  </span>
                  <span className="text-text-primary">
                    {item.disponivel === 1 ? "1 peça" : `${item.disponivel} peças`} ·{" "}
                    {formatMoney(item.salePrice)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
