import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Tem versão nova."
 *
 * Aparece só quando a pessoa está no meio de alguma coisa. Nas telas de
 * entrada o sistema troca de versão sozinho, sem avisar — não há nada a
 * perder ali, e um aviso seria ruído.
 *
 * Recarregar no meio de uma venda apagaria o carrinho, e a vendedora perderia
 * o cliente de vista para remontá-lo. Por isso quem decide a hora é ela: o
 * aviso fica discreto num canto e espera.
 */
export function AvisoDeAtualizacao({ aplicar }: { aplicar: () => void }) {
  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-surface p-4 shadow-lifted">
      <p className="flex items-center gap-2 font-medium text-text-primary">
        <RefreshCw className="h-5 w-5 text-gold-dark" aria-hidden />
        Tem uma versão nova do sistema
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        Atualize quando terminar o que está fazendo — a tela recarrega, e uma venda em andamento se
        perde.
      </p>

      <Button type="button" className="mt-3 w-full" onClick={aplicar}>
        Atualizar agora
      </Button>
    </div>
  );
}
