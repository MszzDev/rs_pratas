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
  /** Corpo em texto puro. Não usamos HTML: menos superfície e melhor entrega. */
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
