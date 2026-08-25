import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, X } from "lucide-react";
import { useAuth } from "./auth-context";

/** A partir de quantos dias o aviso aparece. Mesmo número do servidor. */
const AVISAR_A_PARTIR_DE_DIAS = 5;

function texto(dias: number): string {
  if (dias <= 0) return "Seu PIN vence hoje";
  if (dias === 1) return "Seu PIN vence amanhã";
  return `Seu PIN vence em ${dias} dias`;
}

/**
 * O aviso de que o PIN está para vencer.
 *
 * Começa cinco dias antes, e não no dia: quem trabalha em escala pode ter
 * duas folgas no meio do caminho, e descobrir o vencimento na porta da loja
 * com fila esperando é exatamente o que este aviso existe para evitar.
 *
 * Dá para fechar — mas volta na próxima tela aberta. Um aviso que some para
 * sempre no primeiro clique não avisa nada; um que não fecha atrapalha o
 * trabalho de quem já entendeu e vai trocar no fim do expediente.
 */
export function PinExpiryNotice() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [fechado, setFechado] = useState(false);

  const dias = user?.pinExpiresInDays ?? null;

  if (fechado || user?.pinExpired || dias === null || dias > AVISAR_A_PARTIR_DE_DIAS) {
    return null;
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning/5 p-4 text-sm">
      <KeyRound className="h-5 w-5 shrink-0 text-warning" aria-hidden />

      <p className="flex-1 text-text-primary">
        <strong className="font-semibold">{texto(dias)}.</strong> Trocar leva meio minuto e evita
        ficar de fora do sistema no meio do expediente.
      </p>

      <button
        type="button"
        onClick={() => navigate("/trocar-pin")}
        className="min-h-[40px] rounded-md bg-rose-primary px-4 font-medium text-white"
      >
        Trocar agora
      </button>

      <button
        type="button"
        onClick={() => setFechado(true)}
        aria-label="Fechar aviso"
        className="flex h-10 w-10 items-center justify-center rounded-md text-text-muted hover:bg-background-secondary"
      >
        <X className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
