/**
 * Canal de e-mail — usado para ENTREGAR coisas ao funcionário (credencial do
 * primeiro acesso, aviso sobre um documento), nunca para autenticar.
 *
 * A separação é deliberada: a identidade de login é a matrícula. Se a caixa de
 * e-mail de alguém for invadida, o invasor lê o que foi enviado, mas não entra
 * no sistema — não existe "entrar com e-mail" nem "recuperar senha por link".
 */
export interface EmailMessage {
  to: string;
  subject: string;
  /**
   * Corpo em texto puro. Escrito PRIMEIRO e sempre enviado.
   *
   * É a versão que sobrevive: legível daqui a dois anos, quando a cliente for
   * procurar a garantia no meio da caixa de entrada, e em qualquer cliente de
   * e-mail, inclusive os que não montam HTML.
   */
  text: string;
  /**
   * A mesma coisa, com a cara da loja. Opcional.
   *
   * Vai JUNTO do texto, nunca no lugar dele — quem recebe vê a versão que o
   * seu programa souber mostrar. Sem imagem nenhuma, por escolha: imagem
   * hospedada quebra e `data:` o Gmail remove, e as duas viram um quadrado
   * vazio no lugar da marca.
   */
  html?: string | undefined;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
