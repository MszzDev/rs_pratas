import { useEffect, useState } from "react";
import { apiFetchRaw } from "@/lib/api-client";

/**
 * Arquivos que só saem da API com autorização.
 *
 * Foto de funcionário e documento nunca são servidos estaticamente: passam por
 * uma rota que confere a permissão e audita o acesso. A consequência é que
 * `<img src="...">` e `<a href="...">` NÃO funcionam — o navegador busca esses
 * endereços sem cabeçalho nenhum, e o token de acesso vive na memória da
 * página, não num cookie.
 *
 * Era o defeito: abrir um atestado mostrava a resposta crua do servidor,
 * `{"error":{"code":"UNAUTHENTICATED"...}}`, numa tela preta. E a foto de
 * perfil simplesmente não aparecia, escondida atrás do fallback das iniciais.
 *
 * A saída é buscar o arquivo com o token, como qualquer outra requisição, e
 * transformar o resultado num endereço temporário de memória (`blob:`) que a
 * tela pode usar. O endereço vale só naquela aba e some quando revogado.
 */

async function comoBlob(caminho: string): Promise<string> {
  const resposta = await apiFetchRaw(caminho);
  return URL.createObjectURL(await resposta.blob());
}

/**
 * O endereço de um arquivo protegido, pronto para `<img>` ou `<iframe>`.
 *
 * Revoga o endereço anterior a cada troca e ao desmontar: cada blob segura
 * memória até ser liberado, e uma lista de documentos aberta e fechada dezenas
 * de vezes no expediente acumularia todos eles.
 */
export function useArquivoProtegido(caminho: string | null): {
  url: string | null;
  carregando: boolean;
  erro: boolean;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!caminho) {
      setUrl(null);
      return;
    }

    let vivo = true;
    let criado: string | null = null;

    setCarregando(true);
    setErro(false);

    void comoBlob(caminho)
      .then((endereco) => {
        if (!vivo) {
          URL.revokeObjectURL(endereco);
          return;
        }
        criado = endereco;
        setUrl(endereco);
      })
      .catch(() => {
        if (vivo) setErro(true);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });

    return () => {
      vivo = false;
      if (criado) URL.revokeObjectURL(criado);
    };
  }, [caminho]);

  return { url, carregando, erro };
}
