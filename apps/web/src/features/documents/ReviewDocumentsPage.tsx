import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { DocumentViewer } from "./DocumentViewer";
import { apiFetch, ApiError } from "@/lib/api-client";
import { DocumentAnalysisNotice } from "./DocumentAnalysisNotice";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  type EmployeeDocument,
} from "./types";


const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";

export function ReviewDocumentsPage() {
  const queryClient = useQueryClient();

  /** O documento aberto por cima da tela, ou nulo. */
  const [abrindo, setAbrindo] = useState<EmployeeDocument | null>(null);

  const [status, setStatus] = useState("PENDING_REVIEW");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const documents = useQuery({
    queryKey: ["documents", "review", status],
    queryFn: () =>
      apiFetch<EmployeeDocument[]>(`/api/v1/documents/review?status=${status}`),
  });

  const review = useMutation({
    mutationFn: (params: { id: string; approve: boolean }) =>
      apiFetch(`/api/v1/documents/${params.id}/review`, {
        method: "POST",
        body: { approve: params.approve, comment: comments[params.id]?.trim() ?? "" },
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível registrar."),
  });

  return (
    <PageShell
      title="Conferir documentos"
      description="Atestados e comprovantes enviados pela equipe."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        {[
          { value: "PENDING_REVIEW", label: "Aguardando" },
          { value: "APPROVED", label: "Aprovados" },
          { value: "REJECTED", label: "Recusados" },
        ].map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={status === option.value ? "secondary" : "outline"}
            onClick={() => setStatus(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {documents.data?.length === 0 && (
        <Alert tone="info">
          {status === "PENDING_REVIEW"
            ? "Nenhum documento aguardando conferência."
            : "Nada por aqui."}
        </Alert>
      )}

      <ul className="space-y-5">
        {documents.data?.map((document) => (
          <li key={document.id} className="rounded-lg border border-border bg-surface p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-medium text-text-primary">{document.title}</p>
                <p className="text-sm text-text-secondary">
                  {document.user.name} · matrícula {document.user.employeeCode}
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  {DOCUMENT_TYPE_LABELS[document.type]} · enviado em{" "}
                  {formatDate(document.createdAt)}
                </p>
                {document.referenceStart && (
                  <p className="text-sm text-text-muted">
                    Período informado: {formatDate(document.referenceStart)} a{" "}
                    {formatDate(document.referenceEnd)}
                  </p>
                )}
              </div>

              <span
                className={
                  document.status === "APPROVED"
                    ? "text-success"
                    : document.status === "REJECTED"
                      ? "text-danger"
                      : "text-warning"
                }
              >
                {DOCUMENT_STATUS_LABELS[document.status] ?? document.status}
              </span>
            </div>

            {/*
              Botão e não link, pelo mesmo motivo da tela do funcionário: o
              arquivo só sai da API com o token, e um link não o carrega.
            */}
            <button
              type="button"
              onClick={() => setAbrindo(document)}
              className="mt-4 inline-flex min-h-[48px] items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-rose-primary hover:bg-background-secondary"
            >
              <Paperclip className="h-4 w-4" aria-hidden />
              Abrir {document.fileName}
            </button>

            <div className="mt-4">
              <DocumentAnalysisNotice document={document} />
            </div>

            {document.status === "PENDING_REVIEW" ? (
              <div className="mt-5 border-t border-border pt-5">
                <Field
                  label="Sua observação"
                  value={comments[document.id] ?? ""}
                  onChange={(event) =>
                    setComments((current) => ({ ...current, [document.id]: event.target.value }))
                  }
                  hint="Fica registrado e o funcionário vê. Obrigatório nas duas decisões."
                />

                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: document.id, approve: true })}
                  >
                    <Check className="h-5 w-5" aria-hidden />
                    Aprovar
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: document.id, approve: false })}
                  >
                    <X className="h-5 w-5" aria-hidden />
                    Recusar
                  </Button>
                </div>
              </div>
            ) : (
              document.reviewComment && (
                <p className="mt-4 rounded bg-background-secondary p-3 text-sm">
                  <strong>Observação registrada:</strong> {document.reviewComment}
                </p>
              )
            )}
          </li>
        ))}
      </ul>
      {abrindo && (
        <DocumentViewer
          documentId={abrindo.id}
          titulo={abrindo.title}
          mimeType={abrindo.fileMimeType}
          onClose={() => setAbrindo(null)}
        />
      )}
    </PageShell>
  );
}
