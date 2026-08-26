import { useNavigate } from "react-router-dom";
import { Coins, RefreshCw, ShieldAlert, Wrench, type LucideIcon } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";

/**
 * "Cliente voltou com uma peça."
 *
 * Devolução, troca, garantia e ordem de serviço são quatro conceitos
 * diferentes, com regras, prazos e efeitos no estoque diferentes — e é certo
 * que sejam separados no sistema.
 *
 * Só que para quem está no balcão isso é UMA situação. A pessoa chegou com uma
 * sacola e um problema, e a vendedora precisava saber, antes de qualquer
 * coisa, em qual das quatro telas aquilo se encaixa. Errar a escolha não é
 * inofensivo: devolver o que era garantia devolve dinheiro que não precisava
 * sair, e abrir ordem de serviço no que era defeito cobra do cliente um
 * conserto que a loja devia.
 *
 * Esta tela troca a pergunta técnica ("é devolução ou garantia?") pela
 * pergunta que o cliente já respondeu ("o que houve com a peça?"). O sistema
 * faz a tradução.
 */

interface Porta {
  titulo: string;
  /** O que o cliente disse — é por aqui que a vendedora reconhece o caso. */
  quando: string;
  /** O que vai acontecer. Dito antes, não depois. */
  oQueAcontece: string;
  icone: LucideIcon;
  para: string;
  cor: string;
}

const PORTAS: Porta[] = [
  {
    titulo: "A peça deu problema",
    quando: "Escureceu, quebrou, o fecho soltou, a pedra caiu.",
    oQueAcontece:
      "Vai por garantia. Procure o código da garantia ou a venda; se estiver no prazo, o conserto ou a troca é por conta da loja — o cliente não paga nada.",
    icone: ShieldAlert,
    para: "/pos-venda?aba=garantia",
    cor: "bg-ocean-soft text-ocean",
  },
  {
    titulo: "Não serviu, quer outra",
    quando: "O aro ficou apertado, a corrente ficou curta, não era o que queria.",
    oQueAcontece:
      "Vai como troca. A peça volta para o estoque e o cliente leva outra. Se a nova custar mais, ele paga a diferença.",
    icone: RefreshCw,
    para: "/pos-venda?aba=devolucao&tipo=TROCA",
    cor: "bg-sage-soft text-sage",
  },
  {
    titulo: "Desistiu, quer o dinheiro",
    quando: "Mudou de ideia, o presente não agradou, arrependeu-se da compra.",
    oQueAcontece:
      "Vai como devolução, e o valor sai do caixa. O sistema confere se ainda está dentro do prazo antes de deixar.",
    icone: Coins,
    para: "/pos-venda?aba=devolucao&tipo=DEVOLUCAO",
    cor: "bg-gold-soft text-gold-dark",
  },
  {
    titulo: "Quer ajustar ou consertar",
    quando: "Diminuir o aro, soldar, polir, encurtar a corrente — sem defeito nenhum.",
    oQueAcontece:
      "Vai como ordem de serviço, que é serviço cobrado. Combine o prazo e o valor com o cliente antes de abrir.",
    icone: Wrench,
    para: "/ordens-de-servico",
    cor: "bg-clay-soft text-clay",
  },
];

export function CustomerReturnedPage() {
  const navigate = useNavigate();

  return (
    <PageShell
      title="Cliente voltou com uma peça"
      description="Escolha o que aconteceu. O sistema leva para a tela certa."
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {PORTAS.map((porta) => {
          const Icone = porta.icone;

          return (
            <li key={porta.titulo}>
              <button
                type="button"
                onClick={() => navigate(porta.para)}
                className="flex h-full w-full flex-col items-start gap-3 rounded-lg border border-border bg-surface p-6 text-left shadow-soft transition-colors hover:border-gold-dark hover:bg-background-secondary"
              >
                <span className={`rounded-lg p-3 ${porta.cor}`}>
                  <Icone className="h-6 w-6" aria-hidden />
                </span>

                <span className="text-lg font-medium text-text-primary">{porta.titulo}</span>

                <span className="text-sm text-text-secondary">{porta.quando}</span>

                <span className="mt-auto border-t border-border pt-3 text-sm text-text-muted">
                  {porta.oQueAcontece}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-sm text-text-muted">
        Na dúvida entre garantia e troca: se a peça tem defeito, é garantia — e garantia não custa
        nada para o cliente.
      </p>
    </PageShell>
  );
}
