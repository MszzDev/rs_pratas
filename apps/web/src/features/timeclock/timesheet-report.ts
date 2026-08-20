import type { TimeClockEventType } from "@rs-pratas/shared";
import { workedMinutes } from "@rs-pratas/shared";

export interface ReportEntry {
  id: string;
  nsr: string;
  type: TimeClockEventType;
  timestamp: string;
  isWithinTolerance: boolean | null;
  minutesLate: number | null;
  justification: string | null;
  justificationPending: boolean;
  corrections: Array<{
    id: string;
    nsr: string;
    type: TimeClockEventType;
    timestamp: string;
    reason: string | null;
  }>;
}

export interface DiaDeTrabalho {
  /** "2026-08-20" — chave estável para agrupar e ordenar. */
  data: string;
  rotulo: string;
  entries: ReportEntry[];
  minutosTrabalhados: number;
  /** Minuto do dia (0–1439) da primeira e da última marcação. */
  inicio: number;
  fim: number;
  /** Trechos para desenhar a barra: trabalhado ou intervalo. */
  faixas: Array<{ tipo: "trabalho" | "intervalo"; de: number; ate: number }>;
}

const LABELS: Record<TimeClockEventType, string> = {
  CLOCK_IN: "Entrada",
  CLOCK_OUT: "Saída",
  BREAK_START: "Início do intervalo",
  BREAK_END: "Volta do intervalo",
};

const minutoDoDia = (iso: string) => {
  const quando = new Date(iso);
  return quando.getHours() * 60 + quando.getMinutes();
};

/**
 * Agrupa as marcações por dia e monta as faixas da barra.
 *
 * A barra existe porque uma lista de horários não mostra o formato do dia: com
 * ela dá para ver de longe quem entrou tarde, quem emendou sem intervalo e
 * quem foi embora cedo, sem ler um número sequer.
 */
export function agruparPorDia(entries: ReportEntry[]): DiaDeTrabalho[] {
  const dias = new Map<string, ReportEntry[]>();

  for (const entry of entries) {
    const quando = new Date(entry.timestamp);
    const chave = [
      quando.getFullYear(),
      String(quando.getMonth() + 1).padStart(2, "0"),
      String(quando.getDate()).padStart(2, "0"),
    ].join("-");

    dias.set(chave, [...(dias.get(chave) ?? []), entry]);
  }

  return [...dias.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([data, doDia]) => {
      const ordenadas = [...doDia].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      const faixas: DiaDeTrabalho["faixas"] = [];
      let aberta: { tipo: "trabalho" | "intervalo"; de: number } | null = null;

      for (const entry of ordenadas) {
        const minuto = minutoDoDia(entry.timestamp);

        if (entry.type === "CLOCK_IN" || entry.type === "BREAK_END") {
          if (aberta?.tipo === "intervalo") {
            faixas.push({ ...aberta, ate: minuto });
          }
          aberta = { tipo: "trabalho", de: minuto };
        } else {
          if (aberta?.tipo === "trabalho") {
            faixas.push({ ...aberta, ate: minuto });
          }
          aberta = entry.type === "BREAK_START" ? { tipo: "intervalo", de: minuto } : null;
        }
      }

      // Trecho ainda aberto: quem não bateu a saída aparece até agora, e não
      // some da barra como se não tivesse trabalhado.
      if (aberta) {
        const agora = new Date();
        faixas.push({ ...aberta, ate: agora.getHours() * 60 + agora.getMinutes() });
      }

      const primeira = ordenadas[0];
      const ultima = ordenadas[ordenadas.length - 1];

      return {
        data,
        rotulo: new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
        }),
        entries: ordenadas,
        minutosTrabalhados: workedMinutes(
          ordenadas.map((entry) => ({ type: entry.type, timestamp: new Date(entry.timestamp) })),
          new Date(),
        ),
        inicio: primeira ? minutoDoDia(primeira.timestamp) : 0,
        fim: ultima ? minutoDoDia(ultima.timestamp) : 0,
        faixas,
      };
    });
}

/** Escapa um campo para CSV — aspas dobradas, campo entre aspas. */
const campo = (valor: string | number | null) => `"${String(valor ?? "").replace(/"/g, '""')}"`;

const CABECALHO = [
  "Funcionário",
  "Matrícula",
  "Data",
  "Hora",
  "Marcação",
  "NSR",
  "Atraso (min)",
  "Motivo",
  "Corrigida",
];

/**
 * BOM UTF-8, escrito por código do caractere.
 *
 * Sem ele o Excel abre "Saída" com o acento quebrado. Escrito assim, e não como
 * caractere literal, porque literal ele é invisível no editor — ninguém
 * entenderia por que a primeira linha tem um espaço fantasma.
 */
const BOM = String.fromCharCode(0xfeff);

/** Fim de linha do Windows, que é onde o Excel da loja vai abrir isto. */
const QUEBRA = String.fromCharCode(13, 10);

/**
 * Espelho em CSV, pronto para abrir no Excel.
 *
 * Separador ponto e vírgula de propósito: o Excel em português usa a vírgula
 * como separador decimal e, com vírgula separando campos, joga a planilha
 * inteira numa coluna só.
 */
export function paraCsv(nome: string, matricula: string, dias: DiaDeTrabalho[]): string {
  const linhas = [CABECALHO.map(campo).join(";")];

  for (const dia of dias) {
    for (const entry of dia.entries) {
      const quando = new Date(entry.timestamp);

      linhas.push(
        [
          campo(nome),
          campo(matricula),
          campo(quando.toLocaleDateString("pt-BR")),
          campo(quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })),
          campo(LABELS[entry.type]),
          campo(entry.nsr),
          campo(entry.minutesLate ?? 0),
          campo(entry.justification ?? (entry.justificationPending ? "PENDENTE" : "")),
          campo(entry.corrections.length > 0 ? "sim" : "não"),
        ].join(";"),
      );
    }

    linhas.push(
      [
        campo(nome),
        campo(matricula),
        campo(dia.rotulo),
        campo(""),
        campo("Total do dia"),
        campo(""),
        campo(""),
        campo(`${dia.minutosTrabalhados} min`),
        campo(""),
      ].join(";"),
    );
  }

  return BOM + linhas.join(QUEBRA);
}

/** Entrega o arquivo ao navegador e limpa a URL temporária. */
export function baixar(nomeArquivo: string, conteudo: string, mime: string) {
  const blob = new Blob([conteudo], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Sem isto o blob fica preso na memória da aba até ela ser fechada.
  URL.revokeObjectURL(url);
}
