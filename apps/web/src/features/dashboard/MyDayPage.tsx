import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, CalendarRange, Minus, Target, TrendingUp } from "lucide-react";
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
  semana: {
    faturamento: string;
    vendas: number;
    pecas: number;
    ticketMedio: string;
    diasComVenda: number;
    melhorDia: { dia: string; valor: string } | null;
    semanaPassada: string;
  };
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

            {/*
              No lugar da comissão: a semana.

              A comissão respondia "quanto eu ganho", que é uma pergunta de
              fim de mês e que ninguém muda olhando. A semana responde "como
              estou indo" — e ainda dá tempo de fazer diferente antes que ela
              acabe.
            */}
            <div className="rounded-lg border border-border bg-surface p-5">
              <p className="flex items-center gap-2 text-sm text-text-secondary">
                <CalendarRange className="h-4 w-4 text-gold-dark" aria-hidden />
                Sua semana
              </p>
              <p className="mt-2 text-3xl font-semibold text-text-primary">
                {formatMoney(dia.data.semana.faturamento)}
              </p>
              <p className="mt-1 text-sm text-text-muted">
                {dia.data.semana.vendas === 1
                  ? "1 venda"
                  : `${dia.data.semana.vendas} vendas`}{" "}
                em{" "}
                {dia.data.semana.diasComVenda === 1
                  ? "1 dia"
                  : `${dia.data.semana.diasComVenda} dias`}
              </p>
            </div>
          </div>

          <section className="mt-6 rounded-lg border border-border bg-surface p-6">
            <h2 className="font-semibold text-text-primary">Como a semana está indo</h2>

            <div className="mt-4 grid gap-5 sm:grid-cols-3">
              <div>
                <p className="text-sm text-text-secondary">Comparado à semana passada</p>
                {/*
                  A comparação é com o MESMO TRECHO da semana anterior — numa
                  quarta, com domingo a quarta. Comparar a semana pela metade
                  com a semana passada inteira diria sempre que ela está pior,
                  e número que só desanima acaba ignorado.
                */}
                <ComparacaoDaSemana
                  agora={dia.data.semana.faturamento}
                  antes={dia.data.semana.semanaPassada}
                />
              </div>

              <div>
                <p className="text-sm text-text-secondary">Venda média da semana</p>
                <p className="mt-1 text-xl font-semibold text-text-primary">
                  {formatMoney(dia.data.semana.ticketMedio)}
                </p>
                <p className="mt-0.5 text-sm text-text-muted">
                  {dia.data.semana.pecas === 1
                    ? "1 peça no total"
                    : `${dia.data.semana.pecas} peças no total`}
                </p>
              </div>

              <div>
                <p className="text-sm text-text-secondary">Melhor dia</p>
                {dia.data.semana.melhorDia ? (
                  <>
                    <p className="mt-1 text-xl font-semibold capitalize text-text-primary">
                      {dia.data.semana.melhorDia.dia}
                    </p>
                    <p className="mt-0.5 text-sm text-text-muted">
                      {formatMoney(dia.data.semana.melhorDia.valor)}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-text-muted">Nenhuma venda ainda esta semana.</p>
                )}
              </div>
            </div>
          </section>

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

/**
 * A seta da semana.
 *
 * Sem base de comparação — primeira semana dela na loja — não inventa
 * porcentagem: "primeira semana" é a resposta honesta, e uma seta verde de
 * "+100%" contra zero não significaria nada.
 */
function ComparacaoDaSemana({ agora, antes }: { agora: string; antes: string }) {
  const atual = Number(agora);
  const anterior = Number(antes);

  if (anterior <= 0) {
    return (
      <p className="mt-1 text-sm text-text-muted">
        {atual > 0 ? "Sem semana anterior para comparar." : "Nenhuma venda ainda."}
      </p>
    );
  }

  const variacao = Math.round(((atual - anterior) / anterior) * 100);
  const subiu = variacao > 0;
  const igual = variacao === 0;

  const Icone = igual ? Minus : subiu ? ArrowUpRight : ArrowDownRight;
  const cor = igual ? "text-text-secondary" : subiu ? "text-success" : "text-danger";

  return (
    <>
      <p className={`mt-1 flex items-center gap-1 text-xl font-semibold ${cor}`}>
        <Icone className="h-5 w-5" aria-hidden />
        {igual ? "igual" : `${subiu ? "+" : ""}${variacao}%`}
      </p>
      <p className="mt-0.5 text-sm text-text-muted">
        até aqui, na semana passada: {formatMoney(antes)}
      </p>
    </>
  );
}
