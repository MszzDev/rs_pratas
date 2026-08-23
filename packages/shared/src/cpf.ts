/** Só os dígitos — o cadastro aceita "123.456.789-09" e guarda "12345678909". */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Valida CPF pelos dígitos verificadores.
 *
 * Não é frescura de formulário: o CPF entra no AFD, o arquivo do ponto que a
 * fiscalização lê. Um dígito trocado ali não é um cadastro feio — é um
 * trabalhador que o arquivo não consegue identificar, num documento com valor
 * legal. Melhor recusar na hora do cadastro, com a pessoa na frente.
 */
export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);

  if (cpf.length !== 11) return false;

  // 111.111.111-11 e companhia passam na conta dos dígitos verificadores, mas
  // não são CPF de ninguém.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digito = (ateOndeContar: number): number => {
    let soma = 0;
    let peso = ateOndeContar + 1;

    for (let i = 0; i < ateOndeContar; i += 1) {
      soma += Number(cpf[i]) * peso;
      peso -= 1;
    }

    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

/** "12345678909" -> "123.456.789-09". Devolve como veio se não der 11 dígitos. */
export function formatCpf(value: string): string {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return value;

  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
