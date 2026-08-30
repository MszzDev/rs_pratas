import { Wifi } from "lucide-react";
import { abrirWifi, podeAbrirWifi } from "@/lib/wifi";

/**
 * "Conectar à internet", de dentro do sistema.
 *
 * Aparece SEMPRE que o aplicativo está rodando no tablet — inclusive na tela
 * de entrada, antes de qualquer login. Isso não é excesso de zelo: é o único
 * jeito de o botão existir quando ele é necessário.
 *
 * Sem internet ninguém entra no sistema, e um botão que só aparece depois do
 * login nunca estaria lá no momento em que a loja precisa dele. O mesmo vale
 * para a saída do quiosque, que pede autorização do servidor: sem rede, não há
 * quem autorize.
 *
 * No navegador do computador não aparece — lá não há quiosque para interromper
 * nem tela do Android para abrir, e quem está ali resolve o Wi-Fi pelo próprio
 * sistema operacional.
 */
export function WifiButton({ variante = "menu" }: { variante?: "menu" | "aviso" }) {
  if (!podeAbrirWifi()) return null;

  if (variante === "aviso") {
    return (
      <button
        type="button"
        onClick={() => void abrirWifi()}
        className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium text-text-primary hover:bg-background-secondary"
      >
        <Wifi className="h-5 w-5" aria-hidden />
        Conectar à internet
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void abrirWifi()}
      className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-sm text-text-secondary hover:bg-background-secondary"
    >
      <Wifi className="h-5 w-5" aria-hidden />
      Conectar à internet
    </button>
  );
}
