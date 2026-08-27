import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { DocumentViewer } from "./DocumentViewer";
import { SendFromPhone } from "@/features/uploads/SendFromPhone";
import { apiFetch, ApiError, getAccessToken } from "@/lib/api-client";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPES,
  type DocumentType,
  type EmployeeDocument,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
}

export function MyDocumentsPage() {
  const queryClient = useQueryClient();

  /** O documento aberto por cima da tela, ou nulo. */
  const [abrindo, setAbrindo] = useState<EmployeeDocument | null>(null);

  const [type, setType] = useState<DocumentType>("MEDICAL_CERTIFICATE");
  const [title, setTitle] = useState("");
  const [referenceStart, setReferenceStart] = useState("");
  const [referenceEnd, setReferenceEnd] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const documents = useQuery({
    queryKey: ["documents", "mine"],
    queryFn: () => apiFetch<EmployeeDocument[]>("/api/v1/documents/mine"),
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Anexe o arquivo.");

      const form = new FormData();
      form.append("type", type);
      form.append("title", title);
      if (referenceStart) form.append("referenceStart", referenceStart);
      if (referenceEnd) form.append("referenceEnd", referenceEnd);
      // O arquivo vai por último: o backend lê os campos de texto antes dele.
      form.append("file", file);

      // FormData não passa pelo apiFetch porque o navegador precisa definir o
      // boundary do multipart sozinho — declarar Content-Type quebraria o envio.
      const response = await fetch(`${API_BASE_URL}/api/v1/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
        body: form,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ApiError(
          response.status,
          body?.error?.code ?? "UNKNOWN",
          body?.error?.message ?? "Não foi possível enviar o documento.",
        );
      }

      return response.json() as Promise<EmployeeDocument>;
    },
    onSuccess: () => {
      setSent(true);
      setError(null);
      setTitle("");
      setReferenceStart("");
      setReferenceEnd("");
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["documents", "mine"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível enviar agora."),
  });

  return (
    <PageShell
      title="Meus documentos"
      description="Envie atestado, comprovante de horas ou justificativa de falta."
    >
      {sent && (
        <div className="mb-5">
          <Alert tone="success" title="Documento enviado">
            O gerente vai conferir. Você acompanha a situação aqui mesmo.
          </Alert>
        </div>
      )}

      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/*
        Primeiro caminho, e no tablet o único.
        O modo quiosque não deixa abrir o seletor de arquivos do Android — o
        formulário abaixo existia e era inútil justamente no aparelho onde a
        pessoa passa o dia. Com o celular ela fotografa o papel que está na
        mão, que é como um atestado chega de verdade.
      */}
      <div className="mb-8">
        <SendFromPhone
          purpose="DOCUMENTO"
          titulo="Enviar pelo celular"
          descricao="Aponte a câmera do seu celular para o código e fotografe o documento por lá."
        />
      </div>

      {/*
        O formulário de arquivo NÃO existe no tablet.

        Ele abriria o seletor do Android, que enxerga o armazenamento do
        APARELHO — e o aparelho é compartilhado: a vendedora da tarde veria
        os arquivos que a da manhã deixou ali. Não há pasta por pessoa a
        criar; o armazenamento é do Android, e é de quem estiver com o
        tablet na mão.

        No tablet o caminho é o QR Code acima: ele abre no celular da própria
        pessoa, onde a galeria já é só dela. No computador do dono o
        formulário continua, porque a máquina é dele.
      */}
      {!Capacitor.isNativePlatform() && (
        <form
          className="mb-8 grid gap-5 rounded-lg border border-border bg-surface p-6 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSent(false);
            upload.mutate();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="type" className="text-sm font-medium text-text-secondary">
              Tipo
            </label>
            <select
              id="type"
              value={type}
              onChange={(event) => setType(event.target.value as DocumentType)}
              className="min-h-[48px] rounded-md border border-border bg-surface px-4"
            >
              {DOCUMENT_TYPES.map((option) => (
                <option key={option} value={option}>
                  {DOCUMENT_TYPE_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <Field
            label="Descrição"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ex.: Atestado de 2 dias"
            required
            minLength={3}
          />

          <Field
            label="Válido de"
            type="date"
            value={referenceStart}
            onChange={(event) => setReferenceStart(event.target.value)}
            hint={type === "MEDICAL_CERTIFICATE" ? "Primeiro dia de afastamento." : undefined}
          />
          <Field
            label="Válido até"
            type="date"
            value={referenceEnd}
            onChange={(event) => setReferenceEnd(event.target.value)}
          />

          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label htmlFor="file" className="text-sm font-medium text-text-secondary">
              Arquivo
            </label>
            <input
              id="file"
              type="file"
              accept="application/pdf,image/*"
              required
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="min-h-[48px] rounded-md border border-border bg-surface px-4 py-2.5 file:mr-4 file:rounded file:border-0 file:bg-rose-soft file:px-4 file:py-2 file:text-rose-dark"
            />
            <p className="text-sm text-text-muted">
              Foto ou PDF, até 20 MB. Confira se está legível antes de enviar.
            </p>
          </div>

          <div className="md:col-span-2">
            <Button type="submit" size="lg" disabled={upload.isPending}>
              <FileUp className="h-5 w-5" aria-hidden />
              {upload.isPending ? "Enviando..." : "Enviar documento"}
            </Button>
          </div>
        </form>
      )}

      <h2 className="mb-3 text-lg font-semibold text-text-primary">Enviados</h2>

      {documents.data?.length === 0 && (
        <Alert tone="info">Você ainda não enviou nenhum documento.</Alert>
      )}

      <ul className="space-y-3">
        {documents.data?.map((document) => (
          <li key={document.id} className="rounded-lg border border-border bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-text-primary">{document.title}</p>
                <p className="text-sm text-text-secondary">
                  {DOCUMENT_TYPE_LABELS[document.type]} · enviado em{" "}
                  {formatDate(document.createdAt)}
                </p>
                {document.referenceStart && (
                  <p className="text-sm text-text-muted">
                    Período: {formatDate(document.referenceStart)} a{" "}
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

            {document.reviewComment && (
              <p className="mt-3 rounded bg-background-secondary p-3 text-sm">
                <strong>Resposta do gerente:</strong> {document.reviewComment}
              </p>
            )}

            {/*
              Botão e não link: o endereço da API só entrega o arquivo com o
              token, que vive na memória da página. Um link abriria o endereço
              sem cabeçalho nenhum e mostraria o erro cru do servidor — que foi
              exatamente o que acontecia.
            */}
            <button
              type="button"
              onClick={() => setAbrindo(document)}
              className="mt-3 inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-rose-primary hover:underline"
            >
              <Paperclip className="h-4 w-4" aria-hidden />
              {document.fileName}
            </button>
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
