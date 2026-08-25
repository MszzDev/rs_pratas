import { useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A pergunta que aparece quando alguém sai do sistema em turno aberto.
 *
 * Sair do sistema não é sair do trabalho — a pessoa pode estar passando o
 * tablet para a colega. Por isso a saída do ponto não é automática: seria
 * registrar um fim de expediente que não aconteceu, e marcação de ponto não
 * se corrige apagando.
 *
 * O que a tela faz é não deixar passar batido. O caminho fácil é bater a
 * saída; sair sem bater continua possível, porque quem ficou sem registrar
 * ainda precisa poder fechar o sistema — e o buraco no espelho de ponto vai
 * aparecer para o responsável de qualquer forma.
 */
export function LeaveWithoutClockOut({
  diaCurto,
  onSairMesmoAssim,
  onCancelar,
}: {
  diaCurto: boolean;
  onSairMesmoAssim: () => void;
  onCancelar: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-saida"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lifted">
        <div className="mb-4 flex items-center gap-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-ocean-soft text-ocean"
            aria-hidden
          >
            <Clock className="h-6 w-6" />
          </span>
          <h2 id="titulo-saida" className="text-lg font-semibold text-text-primary">
            Você ainda está em turno
          </h2>
        </div>

        <p className="text-text-secondary">
          {diaCurto
            ? "Seu turno ainda não chegou à jornada mínima, então a saída vai pedir uma explicação. Quer registrar agora?"
            : "Registre a saída antes de sair do sistema. Leva um toque."}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            onClick={() => {
              onCancelar();
              navigate("/ponto");
            }}
          >
            Bater o ponto de saída
          </Button>

          <Button type="button" variant="outline" onClick={onCancelar}>
            Continuar trabalhando
          </Button>

          <Button type="button" variant="ghost" onClick={onSairMesmoAssim}>
            Sair sem registrar
          </Button>
        </div>
      </div>
    </div>
  );
}
