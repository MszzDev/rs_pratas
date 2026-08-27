import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useArquivoProtegido } from "@/lib/protected-file";

/**
 * Ver o documento sem sair do sistema.
 *
 * Abrir numa aba nova não serve: no tablet do balcão o modo quiosque não deixa
 * abrir aba nenhuma, e o endereço da API sem cabeçalho de autenticação devolve
 * a resposta crua de erro numa tela preta — que foi exatamente o que aconteceu.
 *
 * Aqui o arquivo é buscado com o token, como qualquer outra requisição, e
 * mostrado por cima da tela. Imagem vira imagem; PDF entra num quadro que o
 * próprio navegador desenha.
 */
export function DocumentViewer({
  documentId,
  titulo,
  mimeType,
  onClose,
}: {
  documentId: string;
  titulo: string;
  mimeType: string;
  onClose: () => void;
}) {
  const { url, carregando, erro } = useArquivoProtegido(`/api/v1/documents/${documentId}/file`);
  const imagem = mimeType.startsWith("image/");

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-text-primary/80 p-4"
      role="dialog"
      aria-label={`Documento: ${titulo}`}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden rounded-lg bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="min-w-0 truncate font-medium text-text-primary">{titulo}</h2>
          <Button type="button" variant="ghost" onClick={onClose}>
            <X className="h-5 w-5" aria-hidden />
            Fechar
          </Button>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-background-secondary p-4">
          {carregando && <p className="text-text-secondary">Abrindo o documento...</p>}

          {erro && (
            <Alert tone="error" title="Não foi possível abrir">
              Ou o documento foi enviado antes de o sistema passar a guardá-los no banco, ou sua
              sessão expirou. Entre de novo e tente uma vez mais.
            </Alert>
          )}

          {url && imagem && (
            <img
              src={url}
              alt={titulo}
              className="max-h-full max-w-full object-contain"
            />
          )}

          {url && !imagem && (
            // `<iframe>` e não `<embed>`: é o que o WebView do Android
            // desenha, e é onde o PDF do atestado precisa aparecer.
            <iframe src={url} title={titulo} className="h-full w-full border-0" />
          )}
        </div>
      </div>
    </div>
  );
}
