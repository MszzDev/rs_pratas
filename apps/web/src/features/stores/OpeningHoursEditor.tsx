import { Copy } from "lucide-react";
import {
  DIAS_DA_SEMANA,
  ROTULO_DO_DIA,
  type Intervalo,
  type StoreHours,
} from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";

const CHAVES = [...DIAS_DA_SEMANA, "feriado"] as const;
type Chave = (typeof CHAVES)[number];

/**
 * O horário anunciado da loja, um dia por linha.
 *
 * Dia sem hora preenchida é dia fechado — não há caixa "fechado" para marcar,
 * porque a ausência já diz isso e uma caixa a mais em oito linhas é oito
 * cliques a mais.
 *
 * O botão de repetir existe porque, na prática, cinco ou seis dias têm o mesmo
 * horário: preencher a segunda e mandar repetir é o caminho real, e digitar
 * "10:00 às 19:00" seis vezes é o caminho que ninguém percorre até o fim.
 */
export function OpeningHoursEditor({
  valor,
  aoMudar,
}: {
  valor: StoreHours;
  aoMudar: (proximo: StoreHours) => void;
}) {
  function ajustar(dia: Chave, campo: keyof Intervalo, hora: string) {
    const atual = valor[dia];

    // Apagar as duas horas fecha o dia: é o gesto natural de quem quer dizer
    // "não abre", sem precisar procurar outro controle.
    const proximo: Intervalo | null = hora
      ? { abre: atual?.abre ?? "", fecha: atual?.fecha ?? "", [campo]: hora }
      : atual && (campo === "abre" ? atual.fecha : atual.abre)
        ? { ...atual, [campo]: "" }
        : null;

    aoMudar({ ...valor, [dia]: proximo });
  }

  function repetirSegunda() {
    const base = valor.segunda;
    if (!base) return;

    aoMudar({
      ...valor,
      terca: { ...base },
      quarta: { ...base },
      quinta: { ...base },
      sexta: { ...base },
      sabado: { ...base },
    });
  }

  return (
    <fieldset className="rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium text-text-secondary">
        Horário de funcionamento
      </legend>

      <p className="mb-3 text-sm text-text-muted">
        Dia sem horário é dia fechado. É o horário anunciado da loja — quem diz se ela está aberta
        agora continua sendo o primeiro login no tablet.
      </p>

      <div className="space-y-2">
        {CHAVES.map((dia) => (
          <div key={dia} className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 text-sm text-text-secondary">{ROTULO_DO_DIA[dia]}</span>

            <input
              type="time"
              value={valor[dia]?.abre ?? ""}
              onChange={(evento) => ajustar(dia, "abre", evento.target.value)}
              aria-label={`${ROTULO_DO_DIA[dia]} — abre`}
              className="min-h-[44px] rounded-md border border-border bg-surface px-3 text-text-primary"
            />

            <span className="text-sm text-text-muted">às</span>

            <input
              type="time"
              value={valor[dia]?.fecha ?? ""}
              onChange={(evento) => ajustar(dia, "fecha", evento.target.value)}
              aria-label={`${ROTULO_DO_DIA[dia]} — fecha`}
              className="min-h-[44px] rounded-md border border-border bg-surface px-3 text-text-primary"
            />

            {!valor[dia] && <span className="text-sm text-text-muted">fechado</span>}

            {dia === "segunda" && valor.segunda && (
              <Button type="button" variant="ghost" onClick={repetirSegunda}>
                <Copy className="h-4 w-4" aria-hidden />
                Repetir até sábado
              </Button>
            )}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
