import type { EmailMessage } from "./email.provider.js";

/**
 * E-mail de credencial do primeiro acesso.
 *
 * Sem link, sem botão, sem token na URL — de propósito. Um link de "ativar
 * conta" transformaria a caixa de e-mail em porta de entrada do sistema, que é
 * exatamente o que a escolha por matrícula evita. O funcionário abre o app e
 * digita o que está aqui.
 */
export function credentialsEmail(params: {
  to: string;
  name: string;
  employeeCode: string;
  temporaryPassword: string;
  companyName: string;
}): EmailMessage {
  const firstName = params.name.split(" ")[0] ?? params.name;

  return {
    to: params.to,
    subject: `Seu acesso ao sistema da ${params.companyName}`,
    text: [
      `Olá, ${firstName}.`,
      "",
      "Seu cadastro no sistema foi criado. Para entrar, use:",
      "",
      `  Matrícula: ${params.employeeCode}`,
      `  Senha temporária: ${params.temporaryPassword}`,
      "",
      "No primeiro acesso o sistema vai pedir que você troque essa senha e crie",
      "um PIN de 4 ou 6 números — o PIN é o que você usa no tablet da loja, para",
      "bater o ponto e vender.",
      "",
      "Guarde essa senha só até trocá-la. Depois disso ela não vale mais.",
      "",
      "Ninguém da empresa vai te pedir sua senha ou seu PIN por mensagem ou",
      "telefone. Se pedirem, não é a empresa.",
    ].join("\n"),
  };
}

/** Reenvio: o funcionário perdeu a credencial antes de concluir o cadastro. */
export function credentialsResetEmail(params: {
  to: string;
  name: string;
  employeeCode: string;
  temporaryPassword: string;
  companyName: string;
}): EmailMessage {
  const firstName = params.name.split(" ")[0] ?? params.name;

  return {
    to: params.to,
    subject: `Nova senha temporária — ${params.companyName}`,
    text: [
      `Olá, ${firstName}.`,
      "",
      "Foi gerada uma nova senha temporária para o seu primeiro acesso.",
      "A anterior deixou de funcionar neste momento.",
      "",
      `  Matrícula: ${params.employeeCode}`,
      `  Senha temporária: ${params.temporaryPassword}`,
      "",
      "Se não foi você quem pediu, avise o responsável pela loja.",
    ].join("\n"),
  };
}

/** Aviso do resultado da conferência de um documento enviado pelo funcionário. */
export function documentReviewedEmail(params: {
  to: string;
  name: string;
  documentLabel: string;
  approved: boolean;
  note?: string;
}): EmailMessage {
  const firstName = params.name.split(" ")[0] ?? params.name;

  return {
    to: params.to,
    subject: params.approved
      ? `${params.documentLabel} aprovado`
      : `${params.documentLabel} não aceito`,
    text: [
      `Olá, ${firstName}.`,
      "",
      params.approved
        ? `Seu ${params.documentLabel.toLowerCase()} foi conferido e aceito.`
        : `Seu ${params.documentLabel.toLowerCase()} não foi aceito.`,
      ...(params.note ? ["", `Observação: ${params.note}`] : []),
      "",
      "Você pode acompanhar tudo pela aba Meus documentos.",
    ].join("\n"),
  };
}
