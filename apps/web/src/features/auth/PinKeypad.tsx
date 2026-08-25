import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"] as const;

/**
 * O teclado numérico do próprio sistema.
 *
 * Não é enfeite: no tablet em modo quiosque o teclado do Android é uma via de
 * saída do aplicativo — ele traz a barra de navegação junto. Digitar PIN pelo
 * teclado da tela mantém o aparelho preso onde deve ficar.
 *
 * As bolinhas mostram quantos números já entraram sem mostrar quais: quem
 * está do outro lado do balcão vê o progresso, não o PIN.
 */
export function PinKeypad({
  valor,
  aoMudar,
  tamanho = 6,
  desabilitado = false,
  aoCompletar,
}: {
  valor: string;
  aoMudar: (proximo: string) => void;
  tamanho?: number;
  desabilitado?: boolean;
  /** Chamado quando o último número entra — evita um botão "OK" a mais. */
  aoCompletar?: (valor: string) => void;
}) {
  function pressionar(tecla: string) {
    if (tecla === "backspace") {
      aoMudar(valor.slice(0, -1));
      return;
    }

    const proximo = `${valor}${tecla}`.slice(0, tamanho);
    aoMudar(proximo);

    if (proximo.length === tamanho) {
      aoCompletar?.(proximo);
    }
  }

  return (
    <div>
      <div
        className="mb-6 flex justify-center gap-3"
        role="status"
        aria-label={`${valor.length} de ${tamanho} números digitados`}
      >
        {Array.from({ length: tamanho }, (_, indice) => (
          <span
            key={indice}
            className={`h-4 w-4 rounded-full border-2 ${
              indice < valor.length ? "border-rose-primary bg-rose-primary" : "border-border"
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {TECLAS.map((tecla, indice) =>
          tecla === "" ? (
            <span key={`vazio-${indice}`} />
          ) : (
            <Button
              key={tecla}
              type="button"
              variant={tecla === "backspace" ? "ghost" : "outline"}
              size="lg"
              disabled={desabilitado}
              onClick={() => pressionar(tecla)}
              aria-label={tecla === "backspace" ? "Apagar último número" : `Número ${tecla}`}
            >
              {tecla === "backspace" ? <Delete className="h-5 w-5" aria-hidden /> : tecla}
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
