import type {
  DocumentAnalysisInput,
  DocumentAnalysisProvider,
  DocumentAnalysisResult,
} from "./analysis.provider.js";

const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
]);

/** Acima disso é quase certo que a foto veio sem compressão — não é fraude. */
const LARGE_FILE_BYTES = 12 * 1024 * 1024;
/** Abaixo disso a imagem provavelmente está ilegível para conferência. */
const SUSPICIOUSLY_SMALL_BYTES = 8 * 1024;

/**
 * Conferências determinísticas, sem modelo de linguagem.
 *
 * Foram escolhidas de propósito: os sinais que realmente pegam problema em
 * atestado — arquivo repetido e período que não bate com a falta — saem do
 * banco de dados, não de interpretar a imagem. São verificáveis, explicáveis e
 * não erram por "achismo".
 *
 * Quando houver credencial de um provedor de IA, ele entra como um segundo
 * analisador que ACRESCENTA leitura do conteúdo (nome do emitente, CRM, dias
 * prescritos) aos achados daqui — sem substituir a decisão humana.
 */
export class RuleBasedDocumentAnalysis implements DocumentAnalysisProvider {
  readonly name = "rule-based";

  async analyze(input: DocumentAnalysisInput): Promise<DocumentAnalysisResult> {
    const findings: string[] = [];
    const extracted: Record<string, unknown> = {
      tipoArquivo: input.mimeType,
      tamanhoKb: Math.round(input.sizeBytes / 1024),
    };

    if (input.context.duplicateOfDocumentId) {
      findings.push(
        "Este mesmo arquivo já foi enviado antes — o conteúdo é idêntico, byte a byte.",
      );
    }

    if (!ACCEPTED_MIME_TYPES.has(input.mimeType)) {
      findings.push(`Formato incomum para documento (${input.mimeType}). Confira se abre.`);
    }

    if (input.sizeBytes < SUSPICIOUSLY_SMALL_BYTES) {
      findings.push("Arquivo muito pequeno — pode estar cortado ou ilegível.");
    }

    if (input.sizeBytes > LARGE_FILE_BYTES) {
      findings.push("Arquivo grande. Costuma ser foto sem compressão, não é problema em si.");
    }

    const period = describePeriod(input);
    if (period) {
      extracted.periodoInformado = period.label;
      extracted.diasInformados = period.days;

      if (period.days > 15) {
        findings.push(
          `Período informado de ${period.days} dias. Afastamento acima de 15 dias costuma ser caso de INSS — confira com a contabilidade.`,
        );
      }

      if (period.startsInFuture) {
        findings.push("O período começa numa data futura. Confira se a data está certa.");
      }

      // A conferência que mais importa, e vem do próprio ponto: o funcionário
      // alegou afastamento num período em que registrou presença.
      if (
        input.type === "MEDICAL_CERTIFICATE" &&
        input.context.workingDaysInPeriod > 0 &&
        input.context.absencesInPeriod === 0
      ) {
        findings.push(
          "Não há falta registrada no ponto nesse período — há marcações de presença nos dias cobertos pelo atestado.",
        );
      }
    } else if (input.type === "MEDICAL_CERTIFICATE") {
      findings.push("Período de afastamento não informado. Peça as datas ao funcionário.");
    }

    return {
      verdict: findings.length > 0 ? "NEEDS_ATTENTION" : "LOOKS_ROUTINE",
      summary:
        findings.length > 0
          ? `${findings.length} ponto(s) para conferir antes de decidir.`
          : "Nada fora do comum nas conferências automáticas.",
      findings,
      extracted,
    };
  }
}

function describePeriod(input: DocumentAnalysisInput) {
  if (!input.referenceStart) return null;

  const start = input.referenceStart;
  const end = input.referenceEnd ?? input.referenceStart;
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);

  return {
    label: `${start.toLocaleDateString("pt-BR")} a ${end.toLocaleDateString("pt-BR")}`,
    days,
    startsInFuture: start.getTime() > Date.now() + 86_400_000,
  };
}
