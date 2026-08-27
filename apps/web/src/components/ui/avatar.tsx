import { useVersaoDaFoto } from "@/features/profile/photo-version";
import { useArquivoProtegido } from "@/lib/protected-file";
import { cn } from "@/lib/utils";

/**
 * O rosto de quem está do outro lado.
 *
 * A foto é buscada COM o token, e não pelo `src` da imagem: o endereço só a
 * entrega a quem está autenticado, e um `<img src>` vai sem cabeçalho nenhum.
 * Antes disto a foto nunca aparecia — falhava em silêncio, e as iniciais
 * entravam no lugar como se ninguém tivesse posto uma.
 *
 * Sem foto, as iniciais. Elas não são um consolo: num balcão que troca de
 * gente várias vezes por dia, duas letras já dizem quem está logado, e não
 * dependem de ninguém ter tirado retrato.
 */
export function Avatar({
  userId,
  nome,
  temFoto = true,
  className,
}: {
  userId?: string | undefined;
  nome?: string | undefined;
  /** Quando a lista já sabe que não há foto, nem tenta buscar. */
  temFoto?: boolean;
  className?: string;
}) {
  /**
   * O `?v=` não é enfeite de cache: é o que faz este retrato descobrir que a
   * foto mudou. O endereço da imagem é fixo, então sem ele quem já tinha a
   * foto na tela continuaria mostrando a antiga depois de trocada ou apagada.
   */
  const versao = useVersaoDaFoto();

  const { url, erro } = useArquivoProtegido(
    userId && temFoto ? `/api/v1/users/${userId}/photo?v=${versao}` : null,
  );

  if (!url || erro) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-rose-soft font-semibold text-rose-dark",
          className,
        )}
      >
        {iniciais(nome)}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt=""
      aria-hidden
      className={cn("shrink-0 rounded-full border border-border object-cover", className)}
    />
  );
}

export function iniciais(nome?: string): string {
  return (nome ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
}
