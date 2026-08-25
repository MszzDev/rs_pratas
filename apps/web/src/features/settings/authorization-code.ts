const CHAVE = "rs.nuvemshop.code";

/**
 * O código que a Nuvemshop devolve depois que o lojista autoriza o aplicativo.
 *
 * Ele chega na barra de endereço, e é aí que quase se perde: se a pessoa não
 * estiver logada, o guarda de rota manda para o login e o endereço inteiro —
 * com o código junto — vai embora. O código vale poucos minutos e serve uma
 * vez só, então perdê-lo significa refazer a autorização inteira sem entender
 * por quê.
 *
 * Por isso ele é recolhido no primeiro instante do carregamento, antes de
 * qualquer navegação, e guardado até a tela de Integrações usá-lo.
 */

/** Recolhe o código da barra de endereço. Chamado antes de a tela montar. */
export function capturarCodigoDeAutorizacao(): void {
  const params = new URLSearchParams(window.location.search);
  const codigo = params.get("code");

  if (!codigo) return;

  sessionStorage.setItem(CHAVE, codigo);

  // Sai do endereço depois de guardado: um código de autorização na barra vira
  // um código no histórico do navegador, e ele é uma credencial de curta vida.
  params.delete("code");
  const resto = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${resto ? `?${resto}` : ""}`,
  );
}

export function lerCodigoDeAutorizacao(): string | null {
  return sessionStorage.getItem(CHAVE);
}

export function limparCodigoDeAutorizacao(): void {
  sessionStorage.removeItem(CHAVE);
}
