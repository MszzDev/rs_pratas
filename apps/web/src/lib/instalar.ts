/**
 * Instalar o sistema como aplicativo, pelo navegador.
 *
 * No tablet da loja o aplicativo é o APK, instalado por cabo. No celular do
 * dono e no computador da gerente não havia nada: era abrir o site, e o
 * navegador servia a versão que ele tinha guardada — daí o F5 sem parar.
 *
 * Instalado, o sistema abre em janela própria, com ícone, sem barra de
 * endereço. E, principalmente, passa a receber atualização do mesmo jeito que
 * o tablet: o verificador de versão troca sozinho.
 */

/**
 * O aviso que o Chrome dá antes de oferecer a instalação.
 *
 * Ele dispara UMA vez, e cedo — geralmente antes de a tela terminar de montar.
 * Guardar o evento é o que permite oferecer o botão depois, quando a pessoa
 * estiver num lugar onde a oferta faz sentido; sem isso, a chance passa e o
 * botão nunca aparece.
 */
interface EventoDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let guardado: EventoDeInstalacao | null = null;
const ouvintes = new Set<(disponivel: boolean) => void>();

function avisar(): void {
  for (const ouvinte of ouvintes) ouvinte(guardado !== null);
}

/**
 * Começa a ouvir. Chamado uma vez, no início da aplicação — antes de qualquer
 * tela existir, porque o navegador não espera.
 */
export function ouvirConviteDeInstalacao(): void {
  window.addEventListener("beforeinstallprompt", (evento) => {
    // Sem isto o Chrome mostra a própria barra de instalação, no rodapé, que
    // some sozinha e não volta. Preferimos um botão que fica.
    evento.preventDefault();
    guardado = evento as EventoDeInstalacao;
    avisar();
  });

  // Instalou: o convite não vale mais, e o botão precisa sumir.
  window.addEventListener("appinstalled", () => {
    guardado = null;
    avisar();
  });
}

/** Avisa a tela quando o convite aparece ou deixa de valer. */
export function observarInstalacao(ouvinte: (disponivel: boolean) => void): () => void {
  ouvintes.add(ouvinte);
  ouvinte(guardado !== null);

  return () => {
    ouvintes.delete(ouvinte);
  };
}

/** Abre a caixa de instalação do navegador. Devolve se a pessoa aceitou. */
export async function instalar(): Promise<boolean> {
  if (!guardado) return false;

  await guardado.prompt();
  const { outcome } = await guardado.userChoice;

  // O convite é de uso único: depois de mostrado, o navegador não o repete.
  guardado = null;
  avisar();

  return outcome === "accepted";
}

/**
 * Já está rodando instalado?
 *
 * Serve para não oferecer instalação a quem já instalou — e para o próprio
 * navegador do tablet, dentro do APK, não mostrar a oferta.
 */
export function rodandoInstalado(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // O Safari do iPhone não implementa `display-mode`; usa esta propriedade
    // própria, que o TypeScript não conhece.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * O aparelho é iPhone ou iPad?
 *
 * Importa porque o Safari **nunca** dispara o convite de instalação: ele não
 * implementa `beforeinstallprompt`. Um sistema que só mostra o botão quando o
 * convite chega simplesmente não oferece instalação nesses aparelhos — foi o
 * que aconteceu com o iPad da dona, que ficou sem como instalar enquanto o
 * computador instalava normalmente.
 *
 * A detecção do iPad precisa do toque: desde o iPadOS 13 o Safari se identifica
 * como Macintosh para receber os sites de computador. O que sobra para
 * distingui-lo de um Mac de verdade é ter tela sensível ao toque.
 */
export function ehAppleDeToque(): boolean {
  const ua = navigator.userAgent;

  if (/iPad|iPhone|iPod/.test(ua)) return true;

  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/**
 * É o Safari, o único navegador que instala no iPhone e no iPad?
 *
 * Chrome, Firefox e Edge no iOS são o motor do Safari por fora, mas **nenhum
 * deles tem "Adicionar à Tela de Início"**. Quem tentar instalar por ali não
 * acha a opção e conclui que o sistema não permite. Melhor mandar abrir no
 * Safari do que deixar a pessoa procurar um botão que não existe.
 */
export function ehSafari(): boolean {
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/**
 * Como este aparelho instala o sistema.
 *
 * - `automatica`: o navegador oferece, e o botão abre a caixa dele.
 * - `manual`: o aparelho instala, mas só pelo menu do próprio navegador — é o
 *   caso do iPhone e do iPad, e aí o botão precisa **ensinar** em vez de
 *   tentar.
 * - `outro-navegador`: instala, mas não neste navegador.
 * - `nenhuma`: já está instalado, ou o navegador não sabe instalar.
 */
export type FormaDeInstalar = "automatica" | "manual" | "outro-navegador" | "nenhuma";

export function formaDeInstalar(conviteDisponivel: boolean): FormaDeInstalar {
  if (rodandoInstalado()) return "nenhuma";
  if (conviteDisponivel) return "automatica";

  if (ehAppleDeToque()) {
    return ehSafari() ? "manual" : "outro-navegador";
  }

  return "nenhuma";
}

/**
 * Registra o service worker.
 *
 * Ele não guarda nada — existe porque sem service worker o navegador não
 * oferece instalação. O motivo de não guardar está escrito no próprio arquivo.
 */
export function registrarServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  // Depois do `load` para não disputar rede com o que a tela precisa para
  // aparecer. O registro pode esperar; a primeira tela, não.
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Falhar aqui só significa que o botão de instalar não vai aparecer. O
      // sistema funciona igual, e um erro na tela por causa disso seria pior
      // que a ausência do botão.
    });
  });
}
