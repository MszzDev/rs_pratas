import { useQuery } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/features/auth/auth-context";

/**
 * O turno de quem está no balcão.
 *
 * O ponto deixou de ser uma tela que a pessoa visita quando lembra: quem
 * trabalha na loja bate a entrada antes de começar e a saída antes de ir
 * embora. Sem isso, o espelho do mês fica com buracos que ninguém consegue
 * reconstruir depois — e o registro de ponto só vale se for feito na hora.
 *
 * Duas contenções de propósito:
 *
 * - Vale para VENDEDOR e GERENTE. O dono e o suporte não têm jornada a
 *   registrar, e empurrá-los para o relógio de ponto ao abrir o sistema no
 *   celular seria pedir marcação de quem não está em turno.
 * - No TABLET a entrada é exigida; no computador ela é lembrada. O gerente
 *   que abre o sistema em casa às dez da noite não deveria ser levado a
 *   registrar entrada — e o tablet é onde o expediente realmente acontece.
 */

interface ProximoEvento {
  suggestedType: string;
  todayEntries: Array<{ type: string; timestamp: string }>;
  workedMinutes: number;
  shortDay: boolean;
}

const PERFIS_QUE_BATEM_PONTO = ["VENDEDOR", "GERENTE"];

export interface EstadoDoTurno {
  /** Precisa registrar a entrada antes de trabalhar. */
  precisaEntrada: boolean;
  /** Está em turno: entrou e ainda não saiu. */
  turnoAberto: boolean;
  /** Menos que a jornada mínima — sair agora vai pedir explicação. */
  diaCurto: boolean;
  /** A regra vale para este usuário? */
  seAplica: boolean;
  /** No tablet a entrada é exigida; no computador, lembrada. */
  exigirEntrada: boolean;
}

export function useShiftGuard(): EstadoDoTurno {
  const { user } = useAuth();
  const seAplica = Boolean(user && PERFIS_QUE_BATEM_PONTO.includes(user.role));

  const proximo = useQuery({
    // Mesma chave da tela de ponto: bater o ponto lá invalida esta consulta
    // aqui, e a exigência some no instante em que a marcação acontece.
    queryKey: ["timeclock", "next"],
    queryFn: () => apiFetch<ProximoEvento>("/api/v1/timeclock/next"),
    enabled: seAplica,
    // O turno muda quando a pessoa bate o ponto, e é a própria tela de ponto
    // que invalida esta consulta. Um intervalo curto aqui só geraria consulta
    // repetida a cada tela aberta.
    staleTime: 60_000,
  });

  const entradas = proximo.data?.todayEntries ?? [];
  const ultima = entradas[entradas.length - 1];

  return {
    seAplica,
    // Nenhuma marcação hoje: o dia ainda não começou. Depois da saída as
    // marcações continuam lá, então quem encerrou o expediente não é mandado
    // de volta ao relógio para "entrar" de novo.
    precisaEntrada: seAplica && proximo.isSuccess && entradas.length === 0,
    turnoAberto: Boolean(ultima) && ultima?.type !== "CLOCK_OUT",
    diaCurto: proximo.data?.shortDay ?? false,
    exigirEntrada: Capacitor.isNativePlatform(),
  };
}
