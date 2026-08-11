export const DOCUMENT_TYPES = [
  "MEDICAL_CERTIFICATE",
  "HOURS_PROOF",
  "ABSENCE_JUSTIFICATION",
  "OTHER",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  MEDICAL_CERTIFICATE: "Atestado médico",
  HOURS_PROOF: "Comprovante de horas",
  ABSENCE_JUSTIFICATION: "Justificativa de falta",
  OTHER: "Outro documento",
};

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "Aguardando conferência",
  APPROVED: "Aprovado",
  REJECTED: "Recusado",
};

export interface EmployeeDocument {
  id: string;
  type: DocumentType;
  title: string;
  description: string | null;
  referenceStart: string | null;
  referenceEnd: string | null;
  fileName: string;
  fileMimeType: string;
  fileSizeBytes: number;
  status: string;
  reviewedAt: string | null;
  reviewComment: string | null;
  analysisVerdict: "LOOKS_ROUTINE" | "NEEDS_ATTENTION" | "INCONCLUSIVE" | null;
  analysisSummary: string | null;
  analysisFindings: string[];
  analysisExtracted: Record<string, unknown> | null;
  createdAt: string;
  user: { name: string; employeeCode: string };
}
