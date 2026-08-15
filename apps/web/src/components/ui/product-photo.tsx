import { useEffect, useState } from "react";
import { Gem } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchProtectedObjectUrl } from "@/lib/api-client";

const SIZES = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
  xl: "h-40 w-40",
} as const;

/**
 * Foto da peça.
 *
 * A rota da imagem exige autenticação, e `<img src>` não manda cabeçalho — a
 * foto é buscada por fetch e vira um blob local. O `checksum` entra nas
 * dependências do efeito: trocar a foto muda o checksum, o efeito roda de novo
 * e o blob antigo é revogado. Sem isso a peça continuaria mostrando a foto
 * velha até alguém recarregar a página.
 *
 * Sem foto, mostra o ícone de gema em vez de um quadro vazio: no PDV o
 * vendedor percorre a lista com o olho, e um buraco branco chama mais atenção
 * que a peça ao lado.
 */
export function ProductPhoto({
  productId,
  checksum,
  alt,
  size = "md",
  className,
}: {
  productId: string;
  checksum: string | null | undefined;
  alt: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!checksum) {
      setUrl(null);
      return;
    }

    let cancelado = false;
    let criada: string | null = null;

    fetchProtectedObjectUrl(`/api/v1/products/${productId}/image`)
      .then((objectUrl) => {
        // A tela pode ter trocado de produto enquanto a foto vinha: nesse caso
        // a URL é descartada em vez de aparecer na peça errada.
        if (cancelado) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        criada = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));

    return () => {
      cancelado = true;
      // Revoga sempre: sem isso o navegador segura cada foto na memória até a
      // aba fechar, e uma lista de duzentas peças rolada duas vezes já pesa.
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [productId, checksum]);

  const base = cn(
    "shrink-0 overflow-hidden rounded-md border border-border/70 bg-background-secondary",
    SIZES[size],
    className,
  );

  if (!url) {
    return (
      <div className={cn(base, "flex items-center justify-center")} aria-hidden>
        <Gem className="h-1/2 w-1/2 text-text-muted/50" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      // Peça é fotografada de perto e quase sempre fora do quadrado; `cover`
      // preenche a moldura sem deformar a joia.
      className={cn(base, "object-cover")}
    />
  );
}
