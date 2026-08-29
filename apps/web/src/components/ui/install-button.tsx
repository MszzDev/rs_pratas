import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { instalar, observarInstalacao, rodandoInstalado } from "@/lib/instalar";

/**
 * "Instalar aplicativo", no menu.
 *
 * Aparece só quando o navegador tem o que oferecer: some para quem já
 * instalou, para quem está dentro do aplicativo do tablet, e nos navegadores
 * que não sabem instalar — o Firefox no computador, por exemplo.
 *
 * Um botão que abre uma caixa que não existe é pior que botão nenhum: a pessoa
 * clica, nada acontece, e ela conclui que o sistema está com defeito.
 *
 * Fica ao lado de "Sair" porque é assunto do aparelho, não da loja — junto do
 * perfil e do encerrar sessão, e não no meio das telas de trabalho.
 */
export function InstallButton() {
  const [disponivel, setDisponivel] = useState(false);

  useEffect(() => {
    if (rodandoInstalado()) return;
    return observarInstalacao(setDisponivel);
  }, []);

  if (!disponivel) return null;

  return (
    <button
      type="button"
      onClick={() => void instalar()}
      className="flex min-h-[44px] w-full items-center gap-3 rounded-md px-3 text-sm text-text-secondary hover:bg-background-secondary"
    >
      <Download className="h-5 w-5" aria-hidden />
      Instalar aplicativo
    </button>
  );
}
