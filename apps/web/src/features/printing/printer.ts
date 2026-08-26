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
  imprimir(options: { endereco: string; conteudo: string }): Promise<{ impresso: boolean }>;
}

const Impressora = registerPlugin<ImpressoraPlugin>("Impressora");

const CHAVE = "rs.impressora";

export interface ImpressoraEscolhida {
  nome: string;
  endereco: string;
}

export function temImpressora(): boolean {
  return Capacitor.isNativePlatform();
}

export async function lerImpressoraEscolhida(): Promise<ImpressoraEscolhida | null> {
  if (!temImpressora()) return null;

  const { value } = await Preferences.get({ key: CHAVE });
  if (!value) return null;

  try {
    return JSON.parse(value) as ImpressoraEscolhida;
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

export async function listarImpressoras(): Promise<ImpressoraEscolhida[]> {
  if (!temImpressora()) return [];
  const { impressoras } = await Impressora.listar();
  return impressoras;
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

  return "A impressora não respondeu. Confira se está ligada e com papel.";
}

export async function imprimirBytes(conteudo: string): Promise<void> {
  const escolhida = await lerImpressoraEscolhida();

  if (!escolhida) {
    throw new Error("FALTAM_DADOS");
  }

  await Impressora.imprimir({ endereco: escolhida.endereco, conteudo });
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
export function montarComprovante(dados: DadosDoComprovante): string {
  const papel = new Comprovante();

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
