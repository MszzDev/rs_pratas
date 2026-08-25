import { useEffect, useState } from "react";
import { Battery, BatteryCharging, BatteryLow, BatteryMedium } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrightnessControl } from "@/components/ui/brightness-control";

/**
 * Relógio e bateria dentro do próprio sistema.
 *
 * No tablet em modo quiosque a barra do Android está desligada — foi ela que
 * deixava o vendedor sair do aplicativo. Só que junto com a saída se foram as
 * horas e a bateria, e num balcão as duas coisas importam: o horário é o que
 * a pessoa confere antes de bater o ponto, e a bateria é o que decide se o
 * tablet aguenta até o fim do expediente ou precisa ir para a tomada agora.
 *
 * Por isso o sistema mostra os dois por conta própria.
 */

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}

/** Estado da bateria, ou nulo onde o navegador não conta (Firefox, iOS). */
function useBattery(): { porcentagem: number; carregando: boolean } | null {
  const [estado, setEstado] = useState<{ porcentagem: number; carregando: boolean } | null>(null);

  useEffect(() => {
    const getBattery = (
      navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
    ).getBattery;

    if (!getBattery) return;

    let bateria: BatteryManager | undefined;

    // Um único ouvinte, guardado numa variável: passar uma arrow nova para o
    // removeEventListener não remove nada — seria outra função.
    const aoMudar = () => {
      if (!bateria) return;
      setEstado({ porcentagem: Math.round(bateria.level * 100), carregando: bateria.charging });
    };

    void getBattery.call(navigator).then((fonte) => {
      bateria = fonte;
      aoMudar();

      // Os eventos evitam pesquisar de tempos em tempos: o navegador avisa
      // quando o nível muda ou quando o carregador entra e sai.
      fonte.addEventListener("levelchange", aoMudar);
      fonte.addEventListener("chargingchange", aoMudar);
    });

    return () => {
      bateria?.removeEventListener("levelchange", aoMudar);
      bateria?.removeEventListener("chargingchange", aoMudar);
    };
  }, []);

  return estado;
}

/** A hora do aparelho, acertada a cada virada de minuto. */
function useRelogio(): Date {
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    // Acerta primeiro na virada do minuto e só então segue de minuto em
    // minuto: um intervalo fixo de 60s partindo de um momento qualquer faria
    // o relógio mudar de minuto sempre com alguns segundos de atraso.
    let intervalo: ReturnType<typeof setInterval> | undefined;

    const ateOProximoMinuto = 60_000 - (Date.now() % 60_000);

    const primeiro = setTimeout(() => {
      setAgora(new Date());
      intervalo = setInterval(() => setAgora(new Date()), 60_000);
    }, ateOProximoMinuto);

    return () => {
      clearTimeout(primeiro);
      if (intervalo) clearInterval(intervalo);
    };
  }, []);

  return agora;
}

function IconeDaBateria({ porcentagem, carregando }: { porcentagem: number; carregando: boolean }) {
  const classe = cn(
    "h-4 w-4 shrink-0",
    carregando ? "text-sage" : porcentagem <= 15 ? "text-danger" : "text-text-muted",
  );

  if (carregando) return <BatteryCharging className={classe} aria-hidden />;
  if (porcentagem <= 15) return <BatteryLow className={classe} aria-hidden />;
  if (porcentagem <= 60) return <BatteryMedium className={classe} aria-hidden />;
  return <Battery className={classe} aria-hidden />;
}

export function StatusStrip({ className }: { className?: string }) {
  const agora = useRelogio();
  const bateria = useBattery();

  const hora = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  // "25/08" e não "25 de ago.": ao lado da logo, numa barra de 240 pixels, a
  // forma por extenso empurra a bateria para a linha de baixo.
  const dia = agora.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  return (
    <div
      className={cn("flex items-center gap-3 text-sm text-text-secondary", className)}
      // O relógio muda sozinho; sem isto o leitor de tela anunciaria cada
      // virada de minuto no meio do que a pessoa estivesse fazendo.
      aria-live="off"
    >
      <span className="flex items-baseline gap-1.5">
        <time className="font-medium tabular-nums text-text-primary" dateTime={agora.toISOString()}>
          {hora}
        </time>
        <span className="text-xs text-text-muted">{dia}</span>
      </span>

      {bateria && (
        <span
          className="flex items-center gap-1"
          title={
            bateria.carregando
              ? `Bateria em ${bateria.porcentagem}%, carregando`
              : `Bateria em ${bateria.porcentagem}%`
          }
        >
          <IconeDaBateria porcentagem={bateria.porcentagem} carregando={bateria.carregando} />
          <span
            className={cn(
              "tabular-nums",
              !bateria.carregando && bateria.porcentagem <= 15 && "font-semibold text-danger",
            )}
          >
            {bateria.porcentagem}%
          </span>
        </span>
      )}

      {/* Só aparece no tablet: no computador o brilho é do monitor. */}
      <BrightnessControl />
    </div>
  );
}
