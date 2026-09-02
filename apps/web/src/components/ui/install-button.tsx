import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import {
  formaDeInstalar,
  instalar,
  observarInstalacao,
  rodandoInstalado,
  type FormaDeInstalar,
} from "@/lib/instalar";

/**
 * "Instalar aplicativo", no menu.
 *
 * Fica ao lado de "Sair" porque é assunto do aparelho, não da loja — junto do
 * perfil e do encerrar sessão, e não no meio das telas de trabalho.
 *
 * ## Por que não basta esperar o convite do navegador
 *
 * O Chrome avisa quando o site pode ser instalado, e a versão anterior deste
 * botão só aparecia nesse aviso. Só que o **Safari nunca avisa**: ele não
 * implementa esse mecanismo, e no iPhone e no iPad a instalação existe apenas
 * pelo menu de compartilhar.
 *
 * O efeito prático foi que a dona, que trabalha num iPad, não tinha como
 * instalar — o botão simplesmente não existia para ela — enquanto no
 * computador instalava normalmente. O sistema parecia não suportar o aparelho
 * dela, quando na verdade só faltava dizer onde clicar.
 *
 * Então o botão passa a ter três comportamentos, conforme o aparelho: abrir a
 * caixa do navegador, ensinar o caminho do Safari, ou avisar que é preciso
 * abrir no Safari.
 */
export function InstallButton() {
  const [convite, setConvite] = useState(false);
  const [instalado, setInstalado] = useState(false);
  const [ensinando, setEnsinando] = useState(false);

  useEffect(() => {
    if (rodandoInstalado()) {
      setInstalado(true);
      return;
    }
    return observarInstalacao(setConvite);
  }, []);

  const forma: FormaDeInstalar = instalado ? "nenhuma" : formaDeInstalar(convite);
  if (forma === "nenhuma") return null;

  const rotulo =
    forma === "outro-navegador" ? "Como instalar no iPad" : "Instalar aplicativo";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (forma === "automatica") {
            void instalar();
            return;
          }
          setEnsinando(true);
        }}
        className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-sm text-text-secondary hover:bg-background-secondary"
      >
        <Download className="h-5 w-5" aria-hidden />
        {rotulo}
      </button>

      {ensinando && (
        <ComoInstalarNaApple forma={forma} aoFechar={() => setEnsinando(false)} />
      )}
    </>
  );
}

/**
 * O passo a passo do iPhone e do iPad.
 *
 * Com os ícones do próprio Safari desenhados, porque "o botão de compartilhar"
 * não diz nada a quem não sabe qual é — e quem precisa dessa explicação é
 * justamente quem não sabe.
 */
function ComoInstalarNaApple({
  forma,
  aoFechar,
}: {
  forma: FormaDeInstalar;
  aoFechar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-instalar"
      onClick={aoFechar}
    >
      <div
        className="w-full max-w-md rounded-lg bg-surface p-5 shadow-lg"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="titulo-instalar" className="font-semibold text-text-primary">
            Instalar no iPad ou iPhone
          </h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar"
            className="rounded-md p-1 text-text-secondary hover:bg-background-secondary"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {forma === "outro-navegador" ? (
          <div className="mt-3 space-y-3 text-sm text-text-secondary">
            <p>
              Neste aparelho, só o <strong>Safari</strong> consegue instalar. Chrome, Firefox e Edge
              no iPad não têm essa opção — é uma limitação da Apple, não do sistema.
            </p>
            <p>
              Abra o sistema no <strong>Safari</strong> e toque em{" "}
              <strong>Instalar aplicativo</strong> de novo. O passo a passo aparece aqui.
            </p>
          </div>
        ) : (
          <ol className="mt-4 space-y-4 text-sm text-text-secondary">
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background-secondary font-semibold text-text-primary">
                1
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                Toque em <Share className="h-5 w-5 text-text-primary" aria-hidden />
                <strong>Compartilhar</strong>, na barra do Safari.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background-secondary font-semibold text-text-primary">
                2
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                Role a lista e escolha{" "}
                <SquarePlus className="h-5 w-5 text-text-primary" aria-hidden />
                <strong>Adicionar à Tela de Início</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background-secondary font-semibold text-text-primary">
                3
              </span>
              <span>
                Confirme em <strong>Adicionar</strong>. O ícone da RS Pratas aparece na tela
                inicial.
              </span>
            </li>
          </ol>
        )}

        <p className="mt-4 text-sm text-text-secondary">
          Instalado, o sistema abre em tela cheia, sem a barra de endereço, e passa a se atualizar
          sozinho — sem precisar recarregar a página.
        </p>

        <button
          type="button"
          onClick={aoFechar}
          className="mt-4 min-h-[44px] w-full rounded-md bg-rose-primary px-4 font-medium text-white"
        >
          Entendi
        </button>
      </div>
    </div>
  );
}
