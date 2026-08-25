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
  temporaryPin: string;
  companyName: string;
}): EmailMessage {
  const firstName = params.name.split(" ")[0] ?? params.name;

  return {
    to: params.to,
    subject: `Seu acesso ao sistema da ${params.companyName}`,
    text: [
      `Olá, ${firstName}.`,
      "",
      "Seu cadastro no sistema foi criado. No tablet da loja, que é por onde",
      "você vai trabalhar, a entrada é assim:",
      "",
      `  Matrícula: ${params.employeeCode}`,
      `  PIN de entrada: ${params.temporaryPin}`,
      "",
      "Este PIN serve para a primeira entrada. Assim que você entrar, o sistema",
      "pede que você escolha o seu — seis números que só você sabe. Ele vale por",
      "30 dias, e o aviso de troca aparece cinco dias antes.",
      "",
      "Se você também for usar o sistema pelo computador, a senha temporária é",
      `${params.temporaryPassword} — e ela também é trocada no primeiro uso.`,
      "",
      "Ninguém da empresa vai te pedir sua senha ou seu PIN por mensagem ou",
      "telefone. Se pedirem, não é a empresa.",
    ].join("\n"),
  };
}

/** Reenvio: o funcionário perdeu a credencial antes de trocá-la. */
export function credentialsResetEmail(params: {
  to: string;
  name: string;
  employeeCode: string;
  temporaryPassword: string;
  temporaryPin: string;
  companyName: string;
}): EmailMessage {
  const firstName = params.name.split(" ")[0] ?? params.name;

  return {
    to: params.to,
    subject: `Novo PIN de entrada — ${params.companyName}`,
    text: [
      `Olá, ${firstName}.`,
      "",
      "Foram geradas novas credenciais de primeira entrada. As anteriores",
      "deixaram de funcionar neste momento.",
      "",
      `  Matrícula: ${params.employeeCode}`,
      `  PIN de entrada (tablet): ${params.temporaryPin}`,
      `  Senha temporária (computador): ${params.temporaryPassword}`,
      "",
      "Na primeira entrada o sistema pede que você escolha o seu próprio PIN.",
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
