import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

/**
 * Reforços de quiosque no lado do aplicativo.
 *
 * IMPORTANTE: nada aqui é uma trava de segurança. Bloquear o botão voltar e
 * desabilitar o menu de contexto só evita saídas acidentais; um usuário
 * determinado contorna tudo isso. O confinamento real depende do Lock Task
 * Mode do Android com o app registrado como Device Owner — configuração de
 * sistema, feita no provisionamento do tablet, documentada em
 * docs/quiosque-android.md.
 */
export function installKioskGuards(): () => void {
  const cleanups: Array<() => void> = [];

  // Impede o menu de contexto do navegador (copiar, inspecionar, abrir link).
  const blockContextMenu = (event: Event) => event.preventDefault();
  document.addEventListener("contextmenu", blockContextMenu);
  cleanups.push(() => document.removeEventListener("contextmenu", blockContextMenu));

  // Impede seleção de texto por toque longo, que abre a barra de ações do sistema.
  const blockSelection = (event: Event) => event.preventDefault();
  document.addEventListener("selectstart", blockSelection);
  cleanups.push(() => document.removeEventListener("selectstart", blockSelection));

  if (Capacitor.isNativePlatform()) {
    // O botão voltar do Android não pode encerrar o app na tela inicial.
    void App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      }
      // Sem canGoBack: ignora de propósito, para não fechar o aplicativo.
    }).then((handle) => cleanups.push(() => void handle.remove()));
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}

/**
 * Oculta a tela quando o aplicativo vai para segundo plano.
 *
 * O Android tira um retrato do aplicativo para a lista de recentes; sem isso,
 * dados de caixa ou de venda ficariam visíveis na miniatura para quem pegasse
 * o tablet.
 *
 * Só no TABLET. No computador isto cobria a tela a cada troca de aba — e a
 * troca de aba é o gesto mais comum de quem trabalha ali: conferir um pedido
 * no site, voltar. O risco que a cortina evita é o retrato do Android, que no
 * navegador não existe; o incômodo, esse, existia toda hora.
 */
export function installBackgroundPrivacy(onChange: (hidden: boolean) => void): () => void {
  if (!Capacitor.isNativePlatform()) {
    return () => undefined;
  }

  const listener = App.addListener("appStateChange", ({ isActive }) => onChange(!isActive));
  return () => void listener.then((handle) => handle.remove());
}
