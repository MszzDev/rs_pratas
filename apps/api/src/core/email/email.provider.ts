export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailDeliveryResult {
  delivered: boolean;
  providerMessageId?: string;
  error?: string;
}

/**
 * Mesma abordagem dos provedores de pagamento: a aplicação fala com a interface,
 * nunca com um serviço concreto. Enquanto não houver credenciais SMTP, a
 * implementação de log mantém o fluxo inteiro funcionando e testável — e o dia
 * em que o SMTP entrar, nada além da configuração muda.
 */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
}
