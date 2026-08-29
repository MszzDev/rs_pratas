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
