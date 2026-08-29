/**
 * A moldura visual dos e-mails da loja.
 *
 * O corpo em TEXTO PURO continua sendo escrito primeiro e continua sendo
 * enviado — a versão visual acompanha, não substitui. A razão original vale
 * inteira: o comprovante precisa continuar legível daqui a dois anos, quando a
 * cliente for procurar a garantia no meio da caixa de entrada, e cliente de
 * e-mail que não monta HTML ainda existe. Mandar os dois é o que dá a aparência
 * sem abrir mão disso.
 *
 * Três regras que a moldura respeita, e que não são estilo — são o que faz o
 * e-mail chegar inteiro:
 *
 * 1. **Nenhuma imagem.** Nem hospedada, que quebra quando o endereço muda ou o
 *    cliente bloqueia; nem embutida em `data:`, que o Gmail simplesmente
 *    remove. A marca aparece em letra desenhada com tipografia, e não como
 *    arquivo — assim ela nunca vira um quadrado vazio.
 *
 * 2. **Estilo em cada elemento.** Boa parte dos clientes de e-mail descarta
 *    `<style>` no cabeçalho. O que não estiver escrito na própria tag não
 *    existe para eles.
 *
 * 3. **Tabela para a estrutura.** Não é gosto antigo: `div` com largura ainda
 *    é onde o Outlook erra, e o Outlook é o que a contabilidade usa.
 */

/** Vinho da marca, o mesmo da tela. */
const ROSA = "#9B4F53";
const TINTA = "#2B2B2B";
const SUAVE = "#6B6B6B";
const FUNDO = "#F5F1EF";

export interface BlocoDestacado {
  rotulo: string;
  valor: string;
}

/**
 * Monta a versão visual a partir das mesmas partes do texto.
 *
 * `paragrafos` são as frases; `destaques` são os dados que a pessoa vai
 * digitar depois — matrícula, PIN, código da venda. Eles ganham caixa própria
 * e letra de largura fixa porque é isso que evita confundir zero com O, e um
 * com l, na hora de copiar do celular para o tablet.
 */
export function moldarEmail(params: {
  titulo: string;
  saudacao?: string | undefined;
  paragrafos: string[];
  destaques?: BlocoDestacado[] | undefined;
  rodape?: string | undefined;
  empresa: string;
}): string {
  const destaques = params.destaques ?? [];

  const linhasDeDestaque = destaques
    .map(
      (item) => `
            <tr>
              <td style="padding:6px 0;color:${SUAVE};font-size:13px;">${escapar(item.rotulo)}</td>
              <td style="padding:6px 0;text-align:right;font-family:'Courier New',Courier,monospace;font-size:18px;font-weight:bold;color:${TINTA};letter-spacing:1px;">${escapar(item.valor)}</td>
            </tr>`,
    )
    .join("");

  const caixaDeDestaque = destaques.length
    ? `
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${FUNDO};border-radius:6px;margin:20px 0;">
          <tr><td style="padding:16px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${linhasDeDestaque}
            </table>
          </td></tr>
        </table>`
    : "";

  const corpo = params.paragrafos
    .map(
      (texto) =>
        `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TINTA};">${escapar(texto)}</p>`,
    )
    .join("\n        ");

  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px 12px;background:#EFEAE7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:10px;overflow:hidden;">
    <tr>
      <td style="background:${ROSA};padding:22px 28px;">
        <div style="font-size:22px;letter-spacing:5px;color:#FFFFFF;font-weight:bold;">RS PRATAS</div>
        <div style="font-size:12px;letter-spacing:2px;color:#F3DDDE;margin-top:2px;">PRATA 925</div>
      </td>
    </tr>
    <tr>
      <td style="padding:28px;">
        <h1 style="margin:0 0 18px;font-size:19px;color:${TINTA};font-weight:600;">${escapar(params.titulo)}</h1>
        ${params.saudacao ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${TINTA};">${escapar(params.saudacao)}</p>` : ""}
        ${corpo}${caixaDeDestaque}
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px 24px;border-top:1px solid #EFEAE7;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:${SUAVE};">
          ${escapar(params.rodape ?? "Mensagem automática — não é preciso responder.")}
        </p>
        <p style="margin:8px 0 0;font-size:12px;color:${SUAVE};">${escapar(params.empresa)}</p>
      </td>
    </tr>
  </table>
</body></html>`;
}

/**
 * Nome de cliente com `&` ou `<` não pode virar marcação.
 *
 * Parece exagero num e-mail que a própria loja monta, mas o nome vem do que o
 * cliente digitou no site, e "Móveis & Cia <matriz>" quebraria o leiaute
 * inteiro — ou pior, seria o começo de algo que não escrevemos.
 */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

