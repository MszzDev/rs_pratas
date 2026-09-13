import { Socket } from "node:net";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Ator } from "../../core/ator.js";
import { badRequest } from "../../core/errors.js";
import { audit } from "../../core/audit.service.js";

/**
 * O servidor entrega a etiqueta na impressora da casa.
 *
 * ## Por que isto precisa existir
 *
 * A dona etiqueta pelo iPad, que instala o sistema pelo Safari e é só a página
 * web — não tem o plugin nativo que os tablets Android têm. E a impressora de
 * etiqueta só fala TCP cru na porta 9100: navegador nenhum abre esse tipo de
 * conexão, nem Safari nem Chrome. Ela também não tem AirPrint (a porta 631 está
 * fechada), então o caminho que o iPad usaria sozinho não existe.
 *
 * Alguém precisa traduzir. O óbvio seria um computador ou um tablet ao lado da
 * impressora, e foi recusado duas vezes: a impressora fica na casa dela e não
 * vai ter aparelho acompanhante ligado junto.
 *
 * Sobra o servidor. O iPad monta a etiqueta — isso ele faz, o gerador é canvas —
 * e manda os bytes para cá; daqui sai a conexão para a casa, onde o roteador
 * encaminha a porta até a impressora.
 *
 * ## O endereço vem de quem chama, e não de uma configuração
 *
 * Guardar o endereço da casa aqui obrigaria a mexer no servidor toda vez que a
 * operadora trocasse o IP. Como a escolha da impressora já vive no aparelho —
 * é assim para Bluetooth, USB e rede local —, o iPad manda o endereço junto.
 * Uma coisa a menos para desencontrar.
 */

/**
 * Endereços para onde este servidor NUNCA disca.
 *
 * Sem esta trava, qualquer pessoa com acesso ao sistema poderia usar a rota
 * como binóculo para dentro da hospedagem: pedir para "imprimir" em
 * 127.0.0.1 ou em 10.x e descobrir, pelo erro, quais portas internas existem.
 * A impressora de uma casa nunca mora num desses endereços — eles só apareceriam
 * aqui como abuso.
 */
function enderecoProibido(ip: string): string | null {
  if (ip.includes(":")) {
    const baixo = ip.toLowerCase();
    if (baixo === "::1" || baixo.startsWith("fe80") || baixo.startsWith("fc") || baixo.startsWith("fd")) {
      return "endereço interno";
    }
    return null;
  }

  const [a = 0, b = 0] = ip.split(".").map(Number);

  if (a === 127) return "endereço do próprio servidor";
  if (a === 10) return "rede privada";
  if (a === 192 && b === 168) return "rede privada";
  if (a === 172 && b >= 16 && b <= 31) return "rede privada";
  if (a === 169 && b === 254) return "endereço de enlace local";
  if (a === 0 || a >= 224) return "endereço reservado";

  return null;
}

export async function imprimirPelaInternet(params: {
  ator: Ator;
  host: string;
  porta: number;
  /** Os comandos da impressora, em base64 — eles têm bytes que não são texto. */
  conteudo: string;
}): Promise<{ enviado: true }> {
  const { ator, host, porta, conteudo } = params;

  /**
   * Resolve o nome ANTES de conferir.
   *
   * Conferir só o texto digitado deixaria passar um nome de DDNS apontando para
   * um endereço interno — a trava iria embora sem ninguém perceber, que é
   * exatamente como esse tipo de furo costuma aparecer.
   */
  let ip: string;

  if (isIP(host)) {
    ip = host;
  } else {
    try {
      ip = (await lookup(host)).address;
    } catch {
      throw badRequest(
        "PRINTER_HOST_UNKNOWN",
        `Não consegui descobrir onde fica "${host}". Confira o endereço da impressora.`,
      );
    }
  }

  const proibido = enderecoProibido(ip);
  if (proibido) {
    throw badRequest(
      "PRINTER_ADDRESS_NOT_ALLOWED",
      `O endereço ${host} é um ${proibido} e não pode ser alcançado de fora. ` +
        "Use o endereço público da sua internet, não o da rede interna.",
    );
  }

  const bytes = Buffer.from(conteudo, "base64");

  if (bytes.length === 0) {
    throw badRequest("NOTHING_TO_PRINT", "Não veio nada para imprimir.");
  }

  await entregar(ip, porta, bytes);

  await audit(ator.request, {
    action: "PRINT_JOB_CREATE",
    result: "SUCCESS",
    userId: ator.userId,
    companyId: ator.companyId,
    userRoleSnapshot: ator.role,
    entityType: "PrintJob",
    reason: "etiqueta entregue na impressora pela internet",
    metadata: { host, porta, bytes: bytes.length },
  });

  return { enviado: true };
}

/**
 * Escreve os bytes e só desiste depois que o sistema operacional confirma a
 * saída.
 *
 * Fechar assim que o `write` retorna cortaria o último pedaço antes de a
 * impressora ler tudo — o defeito aparece como etiqueta pela metade, e só às
 * vezes, que é o pior jeito de aparecer.
 */
function entregar(ip: string, porta: number, bytes: Buffer): Promise<void> {
  return new Promise((cumprir, recusar) => {
    const socket = new Socket();

    // Doze segundos: a conexão atravessa a internet e um roteador doméstico,
    // que é mais lento que a rede da loja. Curto demais transformaria uma casa
    // com internet ruim em "impressora quebrada".
    socket.setTimeout(12_000);

    socket.connect(porta, ip, () => {
      socket.write(bytes, () => socket.end());
    });

    socket.on("close", () => cumprir());

    socket.on("timeout", () => {
      socket.destroy();
      recusar(
        badRequest(
          "PRINTER_TIMEOUT",
          "A impressora não respondeu. Confira se ela está ligada e se o roteador " +
            "está encaminhando a porta.",
        ),
      );
    });

    socket.on("error", (erro: NodeJS.ErrnoException) => {
      socket.destroy();
      recusar(
        badRequest(
          "PRINTER_UNREACHABLE",
          erro.code === "ECONNREFUSED"
            ? "A conexão foi recusada. O roteador respondeu, mas nada está escutando " +
              "nessa porta — confira o encaminhamento."
            : `Não deu para falar com a impressora: ${erro.message}`,
        ),
      );
    });
  });
}
