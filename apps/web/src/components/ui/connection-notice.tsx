import { CloudOff } from "lucide-react";
import { useConexao } from "@/lib/conexao";
import { WifiButton } from "@/components/ui/wifi-button";

/**
 * A tarja de "sem conexão".
 *
 * Existe porque a alternativa é pior: sem ela, cada tela descobre a queda
 * sozinha e do seu jeito, e o funcionário vê uma mensagem diferente por botão
 * apertado — "não foi possível concluir", "erro ao salvar", "tente de novo" —
 * sem que nenhuma diga a coisa que importa, que é *a internet caiu*.
 *
 * Fica no alto e não sai enquanto durar. É a única informação da tela que a
 * pessoa precisa ver antes de tentar qualquer outra coisa.
 *
 * O texto diz o que AINDA funciona, e não só o que quebrou. Num balcão, "sem
 * internet" sozinho faz a vendedora parar tudo; saber que o ponto continua
 * valendo evita que alguém trabalhe sem registro esperando a rede voltar.
 */
export function ConnectionNotice() {
  const conexao = useConexao();

  if (conexao !== "sem-servidor") return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-md border border-warning/30 bg-warning/10 p-4"
    >
      <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />

      <div className="text-sm">
        <p className="font-medium text-text-primary">Sem conexão com o servidor</p>
        <p className="mt-0.5 text-text-secondary">
          O ponto continua funcionando — a marcação fica guardada no aparelho e é enviada sozinha
          quando a internet voltar. Venda, caixa e estoque precisam de conexão e voltam junto com
          ela.
        </p>

        {/* O botão fica aqui porque é aqui que a pessoa está quando precisa. */}
        <WifiButton variante="aviso" />
      </div>
    </div>
  );
}
