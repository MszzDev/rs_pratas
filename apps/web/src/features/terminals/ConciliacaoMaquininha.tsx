import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { apiFetch } from "@/lib/api-client";

/**
 * O dinheiro da maquininha contra as vendas do sistema.
 *
 * A pergunta do fechamento é uma só: **entrou dinheiro que não virou venda?**
 *
 * O caso é silencioso e custa duas vezes. A vendedora cobra direto na
 * maquininha e pula o sistema — por pressa, por fila, porque o tablet travou.
 * O cliente leva a peça. E aí a peça continua no estoque, disponível para ser
 * vendida de novo, enquanto o faturamento do dia fica menor que o dinheiro que
 * entrou na conta. Nenhum dos dois erros aparece sozinho: o caixa "bate" porque
 * ninguém contou a peça, e a diferença só é notada meses depois, se for.
 *
 * Por isso esta tela mostra a diferença e **não conserta nada sozinha**. Um
 * pagamento não diz qual peça saiu, e chutar isso estragaria o estoque com a
 * aparência de tê-lo corrigido.
 */

interface Diferenca {
  tipo: "PAGAMENTO_SEM_VENDA" | "VENDA_SEM_PAGAMENTO";
  quando: string;
  valor: string;
  referencia: string;
  detalhe: string;
}

interface Resultado {
  loja: string;
  pagamentosNaMaquininha: number;
  vendasNoSistema: number;
  totalNaMaquininha: string;
  totalNoSistema: string;
  diferencas: Diferenca[];
}

export function ConciliacaoMaquininha({ storeId }: { storeId: string }) {
  const [conferir, setConferir] = useState(false);

  const conciliacao = useQuery({
    queryKey: ["conciliacao", storeId],
    enabled: conferir && storeId !== "",
    // Só quando pedida: cada conferência consulta a operadora, e recarregar
    // sozinha a cada troca de tela gastaria chamada à toa.
    staleTime: Infinity,
    queryFn: () =>
      apiFetch<Resultado>(`/api/v1/terminals/conciliacao?storeId=${storeId}`),
  });

  if (!storeId) return null;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="flex items-center gap-2 font-semibold text-text-primary">
        <Scale className="h-5 w-5" aria-hidden />
        Conferir a maquininha
      </h2>

      <p className="mt-1 text-sm text-text-secondary">
        Compara o dinheiro que entrou hoje na maquininha com as vendas registradas no sistema. O que
        aparece aqui não é conserto automático — é o que precisa da sua atenção.
      </p>

      {!conferir && (
        <Button type="button" className="mt-3" onClick={() => setConferir(true)}>
          Conferir hoje
        </Button>
      )}

      {conciliacao.isPending && conferir && (
        <p className="mt-3 text-sm text-text-secondary">Consultando a operadora…</p>
      )}

      {conciliacao.isError && (
        <div className="mt-3">
          <Alert tone="error">
            {conciliacao.error instanceof Error
              ? conciliacao.error.message
              : "Não foi possível conferir agora."}
          </Alert>
        </div>
      )}

      {conciliacao.data && (
        <>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <dt className="text-sm text-text-secondary">Na maquininha</dt>
              <dd className="text-lg font-semibold text-text-primary">
                R$ {conciliacao.data.totalNaMaquininha}
              </dd>
              <dd className="text-sm text-text-secondary">
                {conciliacao.data.pagamentosNaMaquininha} pagamento(s)
              </dd>
            </div>
            <div className="rounded-md border border-border p-3">
              <dt className="text-sm text-text-secondary">No sistema</dt>
              <dd className="text-lg font-semibold text-text-primary">
                R$ {conciliacao.data.totalNoSistema}
              </dd>
              <dd className="text-sm text-text-secondary">
                {conciliacao.data.vendasNoSistema} venda(s) no cartão
              </dd>
            </div>
          </dl>

          {conciliacao.data.diferencas.length === 0 ? (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-border p-3 text-sm text-text-primary">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
              Tudo bate. Cada pagamento tem a sua venda.
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {conciliacao.data.diferencas.map((d) => {
                const grave = d.tipo === "PAGAMENTO_SEM_VENDA";

                return (
                  <li
                    key={`${d.tipo}-${d.referencia}`}
                    className={`rounded-md border p-3 ${
                      grave ? "border-rose-primary bg-rose-50/40" : "border-border"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {grave ? (
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-primary" aria-hidden />
                      ) : (
                        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" aria-hidden />
                      )}

                      <div className="min-w-0">
                        <p className="font-medium text-text-primary">
                          {grave ? "Pagou e não virou venda" : "Venda sem pagamento na maquininha"}
                          {" · "}
                          R$ {d.valor}
                        </p>
                        <p className="text-sm text-text-secondary">
                          {new Date(d.quando).toLocaleString("pt-BR")} ·{" "}
                          {grave ? "pagamento" : "venda"} {d.referencia}
                        </p>
                        <p className="mt-1 text-sm text-text-secondary">{d.detalhe}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={() => void conciliacao.refetch()}
          >
            Conferir de novo
          </Button>
        </>
      )}
    </section>
  );
}
