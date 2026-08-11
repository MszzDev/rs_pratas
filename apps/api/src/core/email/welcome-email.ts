import type { EmailMessage } from "./email.provider.js";

export interface WelcomeEmailParams {
  name: string;
  email: string;
  employeeCode: string;
  temporaryPassword: string;
  companyName: string;
  loginUrl: string;
}

/**
 * E-mail de boas-vindas com matrícula e senha temporária.
 *
 * A senha viaja por e-mail porque é como o dono entrega o acesso ao
 * funcionário, mas ela é de uso único na prática: o primeiro login obriga a
 * troca antes de qualquer outra ação, e a conta só sai de PENDING_FIRST_ACCESS
 * depois disso. Ou seja, uma caixa de entrada comprometida meses depois não
 * vira acesso ao sistema.
 */
export function buildWelcomeEmail(params: WelcomeEmailParams): EmailMessage {
  const text = [
    `Olá, ${params.name}!`,
    "",
    `Seu acesso ao sistema da ${params.companyName} foi criado.`,
    "",
    `Matrícula: ${params.employeeCode}`,
    `Senha temporária: ${params.temporaryPassword}`,
    "",
    `Acesse: ${params.loginUrl}`,
    "",
    "No primeiro acesso você vai criar sua própria senha e um PIN de 4 ou 6 números.",
    "O PIN é o que você usará para entrar rapidamente no tablet da loja.",
    "",
    "A senha temporária acima deixa de valer assim que você criar a sua.",
    "Não compartilhe estes dados com ninguém.",
  ].join("\n");

  const html = `
    <div style="font-family: Inter, Arial, sans-serif; color: #262323; max-width: 520px;">
      <h2 style="color: #9B4F53; font-weight: 600;">Bem-vindo(a) à ${escapeHtml(params.companyName)}</h2>
      <p>Olá, ${escapeHtml(params.name)}! Seu acesso ao sistema foi criado.</p>
      <table style="background: #F8F7F7; border: 1px solid #E7DFE0; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <tr><td style="color: #6F6868; padding: 4px 12px 4px 0;">Matrícula</td><td><strong>${escapeHtml(params.employeeCode)}</strong></td></tr>
        <tr><td style="color: #6F6868; padding: 4px 12px 4px 0;">Senha temporária</td><td><strong>${escapeHtml(params.temporaryPassword)}</strong></td></tr>
      </table>
      <p><a href="${escapeHtml(params.loginUrl)}" style="background: #9B4F53; color: #FFFFFF; padding: 10px 20px; border-radius: 6px; text-decoration: none; display: inline-block;">Acessar o sistema</a></p>
      <p style="color: #6F6868; font-size: 14px;">
        No primeiro acesso você vai criar sua própria senha e um PIN de 4 ou 6 números —
        o PIN é o que você usará para entrar rapidamente no tablet da loja.
      </p>
      <p style="color: #6F6868; font-size: 14px;">
        A senha temporária deixa de valer assim que você criar a sua. Não compartilhe estes dados.
      </p>
    </div>
  `.trim();

  return {
    to: params.email,
    subject: `Seu acesso à ${params.companyName}`,
    text,
    html,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
