import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target, TrendingUp, Wallet } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { Alert } from "@/components/ui/alert";
import { apiFetch } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { useLoja } from "@/features/stores/store-picker";
import { useAuth } from "../auth/auth-context";

interface MeuDia {
  vendas: number;
  pecas: number;
  faturamento: string;
  ticketMedio: string;
  meta: {
    alvo: string;
    alcancado: string;
    faltam: string;
    percentual: number;
    ateQuando: string;
  } | null;
  comissao: {
    valor: string;
    percentual: string;
    base: "FATURAMENTO" | "MARGEM";
    observacao: string | null;
  } | null;
}

/**
 * O dia da vendedora, para a própria vendedora.
 *
 * Antes disto o perfil VENDEDOR não enxergava nada do próprio resultado — nem
 * quanto vendeu, nem quanto falta para a meta, nem quanto de comissão. O
 * caminho para saber era perguntar à gerente, que abria o Painel. Várias vezes
 * por dia, sempre a mesma pergunta.
 *
 * A tela mostra o número DELA e só o dela. Comparação com colegas é assunto do
 * Painel, que tem outro dono e outra permissão: um quadro de classificação no
 * balcão resolveria uma curiosidade e criaria um problema.
 */
export function MyDayPage() {
  const { user } = useAuth();
  const [storeId, setStoreId] = useState("");
  const { lojas, precisaEscolher } = useLoja(storeId, setStoreId);

  const dia = useQuery({
    queryKey: ["meu-dia", storeId],
    queryFn: () => apiFetch<MeuDia>(`/api/v1/reports/my-day?storeId=${storeId}`),
    enabled: storeId !== "",
    // O número precisa acompanhar o expediente: uma venda fechada agora tem
    // que aparecer aqui sem ninguém recarregar a tela.
    refetchInterval: 60_000,
  });

  const primeiroNome = user?.name?.split(" ")[0] ?? "";

  return (
    <PageShell
      title={primeiroNome ? `Seu dia, ${primeiroNome}` : "Seu dia"}
      description="O que você vendeu hoje nesta loja."
    >
      {precisaEscolher && (
        <div className="mb-6 max-w-sm">
          <label htmlFor="loja" className="text-sm font-medium text-text-secondary">
            Loja
          </label>
          <select
            id="loja"
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            className="mt-1.5 min-h-[48px] w-full rounded-md border border-border bg-surface px-4"
          >
            <option value="">Escolha a loja</option>
            {lojas.map((loja) => (
              <option key={loja.id} value={loja.id}>
                {loja.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {dia.data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="flex items-center gap-2 text-sm text-text-secondary">
                <TrendingUp className="h-4 w-4 text-gold-dark" aria-hidden />
                Vendido hoje
              </p>
              <p className="mt-2 text-3xl font-semibold text-text-primary">
                {formatMoney(dia.data.faturamento)}
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {dia.data.vendas === 1 ? "1 venda" : `${dia.data.vendas} vendas`} ·{" "}
                {dia.data.pecas === 1 ? "1 peça" : `${dia.data.pecas} peças`}
              </p>
            </div>

            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="text-sm text-text-secondary">Venda média</p>
              <p className="mt-2 text-3xl font-semibold text-text-primary">
                {formatMoney(dia.data.ticketMedio)}
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {/*
                  O número que mais responde "o que eu faço diferente amanhã?":
                  subir a média é oferecer a segunda peça, não atender mais
                  gente.
                */}
                quanto cada cliente levou, em média
              </p>
            </div>

            {dia.data.comissao ? (
              <div className="rounded-lg border border-border bg-surface p-5">
                <p className="flex items-center gap-2 text-sm text-text-secondary">
                  <Wallet className="h-4 w-4 text-gold-dark" aria-hidden />
                  Sua comissão hoje
                </p>
                <p className="mt-2 text-3xl font-semibold text-text-primary">
                  {formatMoney(dia.data.comissao.valor)}
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  {dia.data.comissao.percentual}% sobre{" "}
                  {dia.data.comissao.base === "MARGEM" ? "a margem" : "o que vendeu"}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface p-5">
                <p className="text-sm text-text-secondary">Comissão</p>
                <p className="mt-2 text-sm text-text-muted">
                  Ainda não há regra de comissão cadastrada para você. Fale com a gerência.
                </p>
              </div>
            )}
          </div>

          {dia.data.comissao?.observacao && (
            <div className="mt-4">
              <Alert tone="info">{dia.data.comissao.observacao}</Alert>
            </div>
          )}

          {dia.data.meta && (
            <section className="mt-6 rounded-lg border border-border bg-surface p-6">
              <h2 className="flex items-center gap-2 font-semibold text-text-primary">
                <Target className="h-5 w-5 text-gold-dark" aria-hidden />
                Sua meta
              </h2>

              <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-background-secondary">
                <div
                  className="h-full rounded-full bg-gold-dark transition-all"
                  style={{ width: `${dia.data.meta.percentual}%` }}
                />
              </div>

              <p className="mt-3 text-lg text-text-primary">
                {formatMoney(dia.data.meta.alcancado)} de {formatMoney(dia.data.meta.alvo)}{" "}
                <span className="text-text-muted">({dia.data.meta.percentual}%)</span>
              </p>

              <p className="mt-1 text-sm text-text-secondary">
                {Number(dia.data.meta.faltam) === 0
                  ? "Meta batida. 👏"
                  : `Faltam ${formatMoney(dia.data.meta.faltam)} até ${new Date(
                      dia.data.meta.ateQuando,
                    ).toLocaleDateString("pt-BR")}.`}
              </p>
            </section>
          )}

          {dia.data.vendas === 0 && (
            <div className="mt-6">
              <Alert tone="info">
                Nenhuma venda registrada hoje ainda. Os números aparecem aqui assim que a primeira
                fechar.
              </Alert>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
