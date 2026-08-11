import type { EmployeeDocumentType } from "@prisma/client";

export interface DocumentAnalysisInput {
  type: EmployeeDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  referenceStart: Date | null;
  referenceEnd: Date | null;
  employee: { id: string; name: string; employeeCode: string };
  /**
   * Contexto vindo do banco, para as conferências que não dependem de ler o
   * arquivo: envios anteriores idênticos e as faltas efetivamente registradas
   * no ponto no período alegado.
   */
  context: {
    duplicateOfDocumentId: string | null;
    absencesInPeriod: number;
    workingDaysInPeriod: number;
  };
}

export type AnalysisVerdict = "LOOKS_ROUTINE" | "NEEDS_ATTENTION" | "INCONCLUSIVE";

export interface DocumentAnalysisResult {
  verdict: AnalysisVerdict;
  summary: string;
  /** Pontos de atenção, em linguagem que o revisor entende sem tradução. */
  findings: string[];
  /** Dados estruturados extraídos, para o revisor não redigitar. */
  extracted: Record<string, unknown>;
}

/**
 * Análise de documento enviado pelo funcionário.
 *
 * IMPORTANTE: o resultado é SEMPRE consultivo. Nenhuma implementação aprova ou
 * reprova documento — quem decide é uma pessoa, e a decisão fica auditada.
 *
 * O motivo não é excesso de cautela: verificar se um atestado é autêntico exige
 * confirmar com quem o emitiu. Um modelo lendo a imagem não faz isso. Ele
 * deixaria passar uma falsificação caprichada e acusaria um atestado legítimo
 * com carimbo borrado — e acusação indevida de fraude tem consequência
 * trabalhista real.
 */
export interface DocumentAnalysisProvider {
  readonly name: string;
  analyze(input: DocumentAnalysisInput): Promise<DocumentAnalysisResult>;
}
