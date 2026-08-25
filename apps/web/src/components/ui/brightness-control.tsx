import { useEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Sun, SunDim } from "lucide-react";

/**
 * O ajuste de brilho do tablet, dentro do próprio sistema.
 *
 * A barra do Android está desligada — foi por ela que o aplicativo escapava —,
 * e com ela se foi o painel de ajustes rápidos. Só que a vitrine da joalheria
 * pega sol de manhã e escurece às seis, e uma tela clara demais à noite cansa
 * quem passa oito horas na frente dela.
 *
 * O ajuste vale só para a janela do aplicativo, e fica guardado no aparelho:
 * quem escolheu de manhã não precisa escolher de novo depois do almoço.
 */

interface KioskPlugin {
  definirBrilho(options: { nivel: number }): Promise<{ nivel: number }>;
  obterBrilho(): Promise<{ nivel: number }>;
}

const Kiosk = registerPlugin<KioskPlugin>("Kiosk");

const CHAVE = "rs.brilho";
const PADRAO = 0.85;

/** Aplica o brilho guardado assim que o aplicativo abre. */
export async function restaurarBrilho(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    const { value } = await Preferences.get({ key: CHAVE });
    const nivel = value ? Number(value) : PADRAO;

    if (Number.isFinite(nivel)) {
      await Kiosk.definirBrilho({ nivel });
    }
  } catch {
    // Brilho é conforto, não função: se o plugin não responder, o aparelho
    // continua no brilho do sistema e o sistema continua funcionando.
  }
}

export function BrightnessControl() {
  const [aberto, setAberto] = useState(false);
  const [nivel, setNivel] = useState(PADRAO);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Preferences.get({ key: CHAVE }).then(({ value }) => {
      const guardado = value ? Number(value) : PADRAO;
      if (Number.isFinite(guardado)) setNivel(guardado);
    });
  }, []);

  // Toque fora fecha. Num tablet não há tecla Esc à mão, e um painel que só
  // fecha pelo mesmo botão fica no caminho de quem já resolveu.
  useEffect(() => {
    if (!aberto) return;

    const aoTocar = (evento: PointerEvent) => {
      if (!caixa.current?.contains(evento.target as Node)) setAberto(false);
    };

    document.addEventListener("pointerdown", aoTocar);
    return () => document.removeEventListener("pointerdown", aoTocar);
  }, [aberto]);

  if (!Capacitor.isNativePlatform()) return null;

  async function ajustar(proximo: number) {
    setNivel(proximo);

    try {
      await Kiosk.definirBrilho({ nivel: proximo });
      await Preferences.set({ key: CHAVE, value: String(proximo) });
    } catch {
      // Mesma razão de `restaurarBrilho`: não vale interromper ninguém por isto.
    }
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((atual) => !atual)}
        aria-expanded={aberto}
        aria-label={`Brilho da tela, em ${Math.round(nivel * 100)}%`}
        className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-background-secondary"
      >
        {nivel < 0.5 ? (
          <SunDim className="h-5 w-5" aria-hidden />
        ) : (
          <Sun className="h-5 w-5" aria-hidden />
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 top-11 z-40 w-64 rounded-lg border border-border bg-surface p-4 shadow-lifted">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">Brilho da tela</span>
            <span className="text-sm tabular-nums text-text-muted">
              {Math.round(nivel * 100)}%
            </span>
          </div>

          <div className="flex items-center gap-2">
            <SunDim className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(nivel * 100)}
              onChange={(evento) => void ajustar(Number(evento.target.value) / 100)}
              aria-label="Brilho da tela"
              className="h-9 w-full accent-rose-primary"
            />
            <Sun className="h-5 w-5 shrink-0 text-text-muted" aria-hidden />
          </div>

          <p className="mt-2 text-xs text-text-muted">Vale só para o RS Pratas neste tablet.</p>
        </div>
      )}
    </div>
  );
}
