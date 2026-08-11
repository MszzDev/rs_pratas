import { Alert } from "@/components/ui/alert";
import type { EmployeeDocument } from "./types";

/**
 * Mostra o parecer automático deixando claro que é sugestão.
 *
 * O texto é deliberado: quem confere precisa entender que a conferência
 * automática olha datas e repetição, não autenticidade. Um aviso genérico do
 * tipo "documento suspeito" levaria alguém a recusar um atestado legítimo
 * achando que o sistema detectou fraude — o que ele não sabe fazer.
 */
export function DocumentAnalysisNotice({ document }: { document: EmployeeDocument }) {
  if (!document.analysisVerdict) return null;

  const hasFindings = document.analysisFindings.length > 0;

  return (
    <Alert
      tone={hasFindings ? "info" : "success"}
      title={hasFindings ? "Pontos para conferir" : "Conferência automática sem apontamentos"}
    >
      {hasFindings ? (
        <ul className="list-disc space-y-1 pl-5">
          {document.analysisFindings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      ) : (
        <p>{document.analysisSummary}</p>
      )}

      <p className="mt-3 text-sm">
        Estas conferências comparam datas com o ponto e detectam arquivo repetido.{" "}
        <strong>Elas não verificam se o documento é autêntico</strong> — isso depende de confirmar
        com quem emitiu. A decisão é sua.
      </p>
    </Alert>
  );
}
