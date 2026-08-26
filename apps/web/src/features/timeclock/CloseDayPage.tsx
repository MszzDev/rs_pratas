import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Check, Clock, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/money";
import { useLoja } from "@/features/stores/store-picker";
import { readDeviceId } from "@/lib/secure-storage";
import { useAuth } from "../auth/auth-context";

interface CashSession {
  id: string;
  code: string;
  status: "ABERTO" | "FECHADO";
  openedAt: string;
  openedById: string;
  cashRegister: { name: string };
  openedBy: { name: string };
}

interface ProximaBatida {
  suggestedType: string;
  allowedTypes: string[];
  workedMinutes: number;
  shortDay: boolean;
  todayEntries: Array<{ id: string; type: string; timestamp: string }>;
}

interface MeuDia {
  vendas: number;
  pecas: number;
  faturamento: string;
  comissao: { valor: string } | null;
}

/**
 * Fechar o dia.
 *
 * Ao fim do turno a pessoa precisa fazer duas coisas em ordem: fechar o caixa
 * com a contagem cega e bater o ponto de saída. Elas moravam em duas telas
 * diferentes de um menu, e nada avisava que faltou uma.
 *
 * O esquecimento clássico é o caixa. Um turno que passa da noite aberto trava
 * a abertura do dia seguinte, mistura o dinheiro de dois dias na mesma gaveta,
 * e — desde que o desligamento de funcionário passou a exigir caixa fechado —
 * trava também a saída de quem foi embora da empresa.
 *
 * A ordem importa e está imposta aqui: primeiro o caixa, depois o ponto. Bater
 * a saída antes de fechar o caixa registra que a pessoa foi embora e a deixa
 * conferindo dinheiro fora do horário — que é o oposto do que o ponto existe
 * para provar.
 */
export function CloseDayPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [storeId, setStoreId] = useState("");
  const { lojas, precisaEscolher } = useLoja(storeId, setStoreId);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  const sessoes = useQuery({
    queryKey: ["cash-sessions", storeId, "ABERTO"],
    queryFn: () =>
      apiFetch<CashSession[]>(`/api/v1/cash/sessions?storeId=${storeId}&status=ABERTO`),
    enabled: storeId !== "",
  });

  const proxima = useQuery({
    queryKey: ["timeclock-next"],
    queryFn: () => apiFetch<ProximaBatida>("/api/v1/timeclock/next"),
  });

  const dia = useQuery({
    queryKey: ["meu-dia", storeId],
    queryFn: () => apiFetch<MeuDia>(`/api/v1/reports/my-day?storeId=${storeId}`),
    enabled: storeId !== "",
  });

  const baterSaida = useMutation({
    mutationFn: async () => {
      const deviceId = await readDeviceId();

      return apiFetch("/api/v1/timeclock/punch", {
        method: "POST",
        body: { type: "CLOCK_OUT", ...(deviceId ? { deviceId } : {}) },
      });
    },
    onSuccess: () => {
      setErro(null);
      setPronto(true);
      void queryClient.invalidateQueries({ queryKey: ["timeclock-next"] });
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível bater o ponto."),
  });

  const abertos = sessoes.data ?? [];

  /**
   * O caixa que É desta pessoa.
   *
   * Um turno aberto por outra pessoa na mesma loja não é problema dela — e
   * apresentá-lo como pendência faria a vendedora tentar fechar o dinheiro
   * que outra conferiu.
   */
  const meuCaixa = abertos.find((sessao) => sessao.openedById === user?.id);
  const deOutro = abertos.filter((sessao) => sessao.openedById !== user?.id);

  const jaSaiu = (proxima.data?.todayEntries ?? []).some((e) => e.type === "CLOCK_OUT");
  const caixaResolvido = !meuCaixa;
  const tudoFeito = caixaResolvido && (jaSaiu || pronto);

  return (
    <PageShell
      title="Fechar o dia"
      description="Os dois passos do fim do turno, na ordem certa."
    >
      {erro && (
        <div className="mb-5">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}

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

      {storeId && (
        <ol className="space-y-4">
          {/* ---------------------------------------------------- 1. caixa */}
          <li
            className={`rounded-lg border p-6 ${
              caixaResolvido ? "border-border bg-surface" : "border-gold-dark bg-gold-soft"
            }`}
          >
            <div className="flex items-start gap-4">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
                  caixaResolvido
                    ? "bg-success text-contraste"
                    : "bg-gold-dark text-contraste"
                }`}
              >
                {caixaResolvido ? <Check className="h-5 w-5" aria-hidden /> : "1"}
              </span>

              <div className="flex-1">
                <h2 className="flex items-center gap-2 font-semibold text-text-primary">
                  <Wallet className="h-5 w-5 text-gold-dark" aria-hidden />
                  Fechar o caixa
                </h2>

                {meuCaixa ? (
                  <>
                    <p className="mt-1 text-sm text-text-secondary">
                      Você abriu o {meuCaixa.cashRegister.name} às{" "}
                      {new Date(meuCaixa.openedAt).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      . Conte o dinheiro da gaveta e informe o total — o sistema não mostra o
                      esperado antes da contagem, de propósito.
                    </p>

                    <Button type="button" className="mt-4" onClick={() => navigate("/caixa")}>
                      Ir contar o caixa
                    </Button>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-text-secondary">
                    Você não tem caixa aberto. Nada a fazer aqui.
                  </p>
                )}

                {deOutro.length > 0 && (
                  <p className="mt-3 text-sm text-text-muted">
                    {deOutro.length === 1
                      ? `${deOutro[0]?.openedBy.name} também está com um caixa aberto — é ela quem fecha o dela.`
                      : `Outras ${deOutro.length} pessoas estão com caixa aberto — cada uma fecha o seu.`}
                  </p>
                )}
              </div>
            </div>
          </li>

          {/* ----------------------------------------------------- 2. ponto */}
          <li
            className={`rounded-lg border p-6 ${
              jaSaiu || pronto
                ? "border-border bg-surface"
                : caixaResolvido
                  ? "border-gold-dark bg-gold-soft"
                  : "border-border bg-surface opacity-60"
            }`}
          >
            <div className="flex items-start gap-4">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
                  jaSaiu || pronto ? "bg-success text-contraste" : "bg-gold-dark text-contraste"
                }`}
              >
                {jaSaiu || pronto ? <Check className="h-5 w-5" aria-hidden /> : "2"}
              </span>

              <div className="flex-1">
                <h2 className="flex items-center gap-2 font-semibold text-text-primary">
                  <Clock className="h-5 w-5 text-gold-dark" aria-hidden />
                  Bater o ponto de saída
                </h2>

                {jaSaiu || pronto ? (
                  <p className="mt-1 text-sm text-text-secondary">
                    Saída registrada. O espelho de ponto já está atualizado.
                  </p>
                ) : !caixaResolvido ? (
                  <p className="mt-1 text-sm text-text-secondary">
                    Feche o caixa primeiro. Bater a saída agora registraria que você foi embora
                    enquanto ainda está conferindo dinheiro.
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-text-secondary">
                      {proxima.data
                        ? `Você trabalhou ${Math.floor(proxima.data.workedMinutes / 60)}h${String(
                            proxima.data.workedMinutes % 60,
                          ).padStart(2, "0")} hoje.`
                        : "Registra a hora do servidor, não a do tablet."}
                    </p>

                    {proxima.data?.shortDay && (
                      <div className="mt-3">
                        <Alert tone="info">
                          A jornada está abaixo do mínimo do dia. Bater a saída agora é permitido —
                          marcação nunca é recusada — mas pode gerar pedido de justificativa.
                        </Alert>
                      </div>
                    )}

                    <Button
                      type="button"
                      className="mt-4"
                      disabled={baterSaida.isPending}
                      onClick={() => baterSaida.mutate()}
                    >
                      {baterSaida.isPending ? "Registrando..." : "Bater saída agora"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </li>
        </ol>
      )}

      {tudoFeito && dia.data && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold text-text-primary">Seu dia</h2>

          <p className="mt-2 text-text-secondary">
            {dia.data.vendas === 0
              ? "Nenhuma venda registrada hoje."
              : `${dia.data.vendas === 1 ? "1 venda" : `${dia.data.vendas} vendas`}, ${
                  dia.data.pecas === 1 ? "1 peça" : `${dia.data.pecas} peças`
                }, ${formatMoney(dia.data.faturamento)}.`}
            {dia.data.comissao && ` Comissão de ${formatMoney(dia.data.comissao.valor)}.`}
          </p>

          <p className="mt-4 text-lg font-medium text-text-primary">
            Está tudo fechado. Bom descanso.
          </p>
        </div>
      )}
    </PageShell>
  );
}
