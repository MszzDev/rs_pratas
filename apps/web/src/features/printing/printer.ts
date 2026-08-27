import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Comprovante } from "@/lib/escpos";

/**
 * A impressora deste tablet.
 *
 * A escolha é do APARELHO, não da conta: quem entra no tablet do Quiosque Elis
 * Maas imprime na impressora daquele balcão, seja quem for. Guardar isso no
 * servidor, por usuário, faria a vendedora que cobre férias em outra loja
 * mandar o comprovante para o balcão errado.
 */

interface ImpressoraPlugin {
  situacao(): Promise<{ temBluetooth: boolean; ligado: boolean; permitido: boolean }>;
  listar(): Promise<{ impressoras: { nome: string; endereco: string }[] }>;
  listarUsb(): Promise<{ impressoras: { nome: string; endereco: string }[] }>;
  imprimir(options: { endereco: string; conteudo: string }): Promise<{ impresso: boolean }>;
  imprimirNaRede(options: {
    ip: string;
    porta?: number;
    conteudo: string;
  }): Promise<{ impresso: boolean }>;
  imprimirNoUsb(options: { endereco: string; conteudo: string }): Promise<{ impresso: boolean }>;
}

/**
 * Por onde os bytes chegam à impressora.
 *
 * A linguagem é a mesma nas três — ESC/POS —, e é por isso que o comprovante
 * montado uma vez serve para qualquer uma. O que muda é a porta.
 */
export type Ligacao = "BLUETOOTH" | "REDE" | "USB";

const Impressora = registerPlugin<ImpressoraPlugin>("Impressora");

const CHAVE = "rs.impressora";

export interface ImpressoraEscolhida {
  nome: string;
  /** Endereço Bluetooth, caminho do aparelho USB, ou IP na rede. */
  endereco: string;
  ligacao: Ligacao;
  /** Só para rede. 9100 é o padrão de fato das impressoras térmicas. */
  porta?: number;
  /**
   * Largura do papel em colunas de texto.
   *
   * 32 no rolo de 58 mm, 48 no de 80 mm. Fica guardado com a impressora porque
   * é dela: trocar o modelo do balcão sem trocar isto faria o comprovante sair
   * quebrando linha no meio ou desperdiçando metade do papel.
   */
  colunas: number;
}

export function temImpressora(): boolean {
  return Capacitor.isNativePlatform();
}

export async function lerImpressoraEscolhida(): Promise<ImpressoraEscolhida | null> {
  if (!temImpressora()) return null;

  const { value } = await Preferences.get({ key: CHAVE });
  if (!value) return null;

  try {
    const guardada = JSON.parse(value) as Partial<ImpressoraEscolhida>;

    if (!guardada.endereco) return null;

    /**
     * O que foi escolhido antes de existirem rede e USB não tem esses campos.
     * Bluetooth em 32 colunas é o que aquelas escolhas eram — assumir isso é
     * melhor que devolver nulo e fazer o balcão parar de imprimir depois de
     * uma atualização.
     */
    return {
      nome: guardada.nome ?? "Impressora",
      endereco: guardada.endereco,
      ligacao: guardada.ligacao ?? "BLUETOOTH",
      colunas: guardada.colunas ?? 32,
      ...(guardada.porta ? { porta: guardada.porta } : {}),
    };
  } catch {
    return null;
  }
}

export async function guardarImpressora(escolhida: ImpressoraEscolhida | null): Promise<void> {
  if (!escolhida) {
    await Preferences.remove({ key: CHAVE });
    return;
  }
  await Preferences.set({ key: CHAVE, value: JSON.stringify(escolhida) });
}

export async function situacaoDaImpressao() {
  if (!temImpressora()) {
    return { temBluetooth: false, ligado: false, permitido: false };
  }
  return Impressora.situacao();
}

/** As impressoras pareadas por Bluetooth. */
export async function listarImpressoras(): Promise<ImpressoraEscolhida[]> {
  if (!temImpressora()) return [];

  const { impressoras } = await Impressora.listar();
  return impressoras.map((p) => ({ ...p, ligacao: "BLUETOOTH" as const, colunas: 32 }));
}

/** As impressoras ligadas no cabo. */
export async function listarImpressorasUsb(): Promise<ImpressoraEscolhida[]> {
  if (!temImpressora()) return [];

  const { impressoras } = await Impressora.listarUsb();
  return impressoras.map((p) => ({ ...p, ligacao: "USB" as const, colunas: 48 }));
}

/**
 * Traduz a recusa do plugin para o que a pessoa no balcão pode fazer.
 *
 * "FALHOU: read failed, socket might closed" é a mensagem que o Android dá
 * quando a impressora está desligada — e não diz isso a ninguém. Quem está com
 * o cliente na frente precisa saber se aperta um botão, liga um aparelho ou
 * chama alguém.
 */
export function explicarFalha(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : String(erro);

  if (texto.includes("SEM_BLUETOOTH")) {
    return "Este tablet não tem Bluetooth. O comprovante continua indo por e-mail.";
  }
  if (texto.includes("BLUETOOTH_DESLIGADO")) {
    return "O Bluetooth do tablet está desligado. Ligue e tente de novo.";
  }
  if (texto.includes("SEM_PERMISSAO")) {
    return "O tablet não deixou o sistema usar o Bluetooth. Autorize quando ele perguntar.";
  }
  if (texto.includes("FALTAM_DADOS")) {
    return "Nenhuma impressora escolhida para este tablet. Escolha em Ajustes.";
  }

  // --- rede
  if (texto.includes("REDE_FALHOU")) {
    return "A impressora não respondeu na rede. Confira se está ligada, se o cabo está conectado e se o endereço IP é o que aparece no autoteste dela.";
  }

  // --- cabo
  if (texto.includes("USB_AUSENTE")) {
    return "A impressora não está mais no cabo. Reconecte e escolha de novo.";
  }
  if (texto.includes("USB_SEM_PERMISSAO")) {
    return "O Android não deixou o sistema usar a impressora. Ao conectar, marque a permissão — e, se quiser, 'sempre permitir'.";
  }
  if (texto.includes("USB_NAO_E_IMPRESSORA") || texto.includes("USB_SEM_CANAL")) {
    return "Este aparelho USB não se apresenta como impressora. Confira se é o cabo da impressora e não outro acessório.";
  }
  if (texto.includes("USB_FALHOU")) {
    return "A impressora parou de responder no cabo. Confira se está ligada e com papel.";
  }

  return "A impressora não respondeu. Confira se está ligada e com papel.";
}

export async function imprimirBytes(conteudo: string): Promise<void> {
  const escolhida = await lerImpressoraEscolhida();

  if (!escolhida) {
    throw new Error("FALTAM_DADOS");
  }

  // A escolha da porta é a ÚNICA diferença entre os três caminhos. Os bytes
  // são os mesmos, porque a linguagem da impressora é a mesma.
  if (escolhida.ligacao === "REDE") {
    await Impressora.imprimirNaRede({
      ip: escolhida.endereco,
      conteudo,
      ...(escolhida.porta ? { porta: escolhida.porta } : {}),
    });
    return;
  }

  if (escolhida.ligacao === "USB") {
    await Impressora.imprimirNoUsb({ endereco: escolhida.endereco, conteudo });
    return;
  }

  await Impressora.imprimir({ endereco: escolhida.endereco, conteudo });
}

/**
 * Monta o comprovante na largura DESTA impressora e manda imprimir.
 *
 * Existe para a tela de venda não precisar saber quantas colunas o rolo tem.
 * Ela conhece a venda; a largura é assunto do aparelho, e mudá-la não deveria
 * obrigar a mexer no PDV.
 */
export async function imprimirComprovante(dados: DadosDoComprovante): Promise<void> {
  const escolhida = await lerImpressoraEscolhida();

  if (!escolhida) {
    throw new Error("FALTAM_DADOS");
  }

  await imprimirBytes(montarComprovante(dados, escolhida.colunas));
}

// ------------------------------------------------------------------ layout

export interface DadosDoComprovante {
  empresa: { nome: string; cnpj: string };
  loja: { nome: string; cnpj: string; telefone: string | null; endereco: string | null };
  venda: { codigo: string; quando: string; vendedor: string | null };
  cliente: { nome: string } | null;
  itens: { nome: string; sku: string; quantidade: number; unitario: string; total: string }[];
  desconto: string | null;
  total: string;
  pagamentos: { forma: string; valor: string; parcelas: number | null }[];
  garantias: { produto: string; codigo: string; meses: number; ate: string }[];
}

const FORMAS: Record<string, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  DEBITO: "Débito",
  CREDITO: "Crédito",
  CREDIARIO: "Crediário",
  TRANSFERENCIA: "Transferência",
};

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function data(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

/**
 * O comprovante em papel.
 *
 * Não é documento fiscal, e o papel diz isso — em letras que se leem. Um
 * comprovante que se parece com uma nota e não é nota engana o cliente e cria
 * problema para a loja; dizer o que ele é custa uma linha.
 *
 * A ordem segue o que a pessoa confere: primeiro onde comprou, depois o que
 * levou, depois quanto pagou. O total vem em corpo dobrado porque é o número
 * que ela procura primeiro.
 */
export function montarComprovante(dados: DadosDoComprovante, colunas = 32): string {
  const papel = new Comprovante(colunas);

  papel.alinhamento(1).grande(true).negrito(true).linha(dados.empresa.nome);
  papel.grande(false).linha(dados.loja.nome).negrito(false);

  if (dados.loja.endereco) papel.paragrafo(dados.loja.endereco);
  if (dados.loja.telefone) papel.linha(dados.loja.telefone);
  papel.linha(`CNPJ ${dados.loja.cnpj}`);

  papel.alinhamento(0).separador();

  papel.entreExtremos(`Venda ${dados.venda.codigo}`, dataHora(dados.venda.quando));
  if (dados.venda.vendedor) papel.linha(`Atendimento: ${dados.venda.vendedor}`);
  if (dados.cliente) papel.linha(`Cliente: ${dados.cliente.nome}`);

  papel.separador();

  for (const item of dados.itens) {
    papel.paragrafo(item.nome);
    // A conta fica visível: quem levou dois iguais confere o preço da peça sem
    // dividir de cabeça na frente do vendedor.
    papel.entreExtremos(`  ${item.quantidade} x ${item.unitario}`, item.total);
  }

  papel.separador();

  if (dados.desconto) {
    papel.entreExtremos("Desconto", `- ${dados.desconto}`);
  }

  papel.negrito(true).grande(true).entreExtremos("TOTAL", dados.total).grande(false).negrito(false);

  papel.linha();

  for (const pagamento of dados.pagamentos) {
    const forma = FORMAS[pagamento.forma] ?? pagamento.forma;
    const rotulo = pagamento.parcelas && pagamento.parcelas > 1
      ? `${forma} ${pagamento.parcelas}x`
      : forma;
    papel.entreExtremos(rotulo, pagamento.valor);
  }

  if (dados.garantias.length > 0) {
    papel.separador();
    papel.negrito(true).linha("GARANTIA").negrito(false);

    for (const garantia of dados.garantias) {
      papel.paragrafo(garantia.produto);
      papel.linha(`  ${garantia.codigo} · ${garantia.meses} meses`);
      papel.linha(`  vale até ${data(garantia.ate)}`);
    }

    papel.linha();
    papel.paragrafo("Guarde este comprovante: é ele que vale na garantia.");
  }

  papel.separador();
  papel.alinhamento(1);
  papel.linha("Documento nao fiscal");
  papel.paragrafo("Obrigado pela preferencia!");

  return papel.corta().paraBase64();
}
