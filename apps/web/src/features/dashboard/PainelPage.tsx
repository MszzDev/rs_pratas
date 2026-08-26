import { useState } from "react";
import { LayoutDashboard, Percent, TrendingUp } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { useAuth } from "@/features/auth/auth-context";
import { ReportsContent } from "@/features/reports/ReportsPage";
import { CommissionRulesContent } from "@/features/reports/CommissionRulesPage";
import { DashboardContent } from "./DashboardPage";

/**
 * O painel do dono, em abas.
 *
 * Antes eram duas telas separadas — Painel e Relatórios — e a diferença entre
 * elas nunca foi óbvia: as duas respondem "como o negócio está indo", uma
 * agora e a outra no período. Separadas, obrigavam a voltar ao menu para
 * comparar o dia com o mês.
 *
 * Aqui viram a mesma tela: o que está acontecendo agora, o resultado do
 * período, e as regras de comissão e meta que explicam parte desses números.
 */
const ABAS = [
  {
    chave: "agora",
    rotulo: "Agora",
    icone: LayoutDashboard,
    descricao: "Como a rede está neste momento, e como foi o último mês.",
  },
  {
    chave: "resultado",
    rotulo: "Resultado",
    icone: TrendingUp,
    descricao: "Faturamento, margem, vendedores e peças — no período que você escolher.",
  },
  {
    chave: "comissoes",
    rotulo: "Comissões e metas",
    icone: Percent,
    descricao: "As regras que definem quanto cada venda rende, e as metas em andamento.",
    /** Sem esta permissão a aba nem aparece — a tela devolveria 403. */
    permissao: "COMMISSION_MANAGE",
  },
] as const;

export function PainelPage() {
  const { can } = useAuth();
  const [aba, setAba] = useState<string>("agora");

  const disponiveis = ABAS.filter((item) => !("permissao" in item) || can(item.permissao));
  const atual = disponiveis.find((item) => item.chave === aba) ?? disponiveis[0];

  return (
    <PageShell eyebrow="Visão geral" title="Painel" description={atual?.descricao}>
      <div className="mb-6 flex flex-wrap gap-2 border-b border-border/70 pb-4">
        {disponiveis.map((item) => (
          <button
            key={item.chave}
            type="button"
            onClick={() => setAba(item.chave)}
            className={`flex min-h-[40px] items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
              atual?.chave === item.chave
                ? "border-rose-primary bg-rose-soft text-rose-dark"
                : "border-border bg-surface text-text-secondary hover:border-rose-light"
            }`}
          >
            <item.icone className="h-4 w-4 shrink-0" aria-hidden />
            {item.rotulo}
          </button>
        ))}
      </div>

      {atual?.chave === "agora" && <DashboardContent />}
      {atual?.chave === "resultado" && <ReportsContent />}
      {atual?.chave === "comissoes" && <CommissionRulesContent />}
    </PageShell>
  );
}
