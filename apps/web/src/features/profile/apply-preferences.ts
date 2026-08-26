export interface Preferencias {
  theme: "CLARO" | "ESCURO" | "SISTEMA";
  fontScale: number;
  highContrast: boolean;
  reduceMotion: boolean;
}

export const PADRAO: Preferencias = {
  theme: "SISTEMA",
  fontScale: 100,
  highContrast: false,
  reduceMotion: false,
};

const GUARDADO = "rs.preferencias";

/**
 * Aplica as preferências de quem entrou.
 *
 * Mexe em classes e numa variável CSS do elemento raiz — nada mais. Toda cor
 * do sistema aponta para essas variáveis, então `bg-surface`, escrito em
 * dezenas de telas, muda de cor sem que nenhuma delas saiba que existe um
 * tema.
 *
 * O tamanho da letra multiplica a base do documento, e não só a fonte: assim
 * espaçamento, altura de botão e área de toque crescem junto. Aumentar apenas
 * a letra deixaria o texto grande espremido numa caixa do mesmo tamanho — que
 * é pior de ler que a letra pequena.
 */
export function aplicarPreferencias(prefs: Preferencias): void {
  const raiz = document.documentElement;

  const escuro =
    prefs.theme === "ESCURO" ||
    (prefs.theme === "SISTEMA" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  raiz.classList.toggle("dark", escuro);
  raiz.classList.toggle("alto-contraste", prefs.highContrast);
  raiz.classList.toggle("menos-movimento", prefs.reduceMotion);
  raiz.style.setProperty("--escala-texto", String(prefs.fontScale / 100));
}

/**
 * A cópia local, para o tema valer antes de o servidor responder.
 *
 * As preferências moram no cadastro — é do servidor que vem a verdade. Mas o
 * aplicativo abre antes de qualquer resposta chegar, e sem esta cópia quem
 * escolheu a tela escura veria um lampejo branco a cada abertura. Pequeno, e
 * exatamente o tipo de coisa que faz a pessoa desistir do ajuste.
 *
 * Só isso: se a cópia divergir do cadastro, o cadastro corrige no login
 * seguinte.
 */
export function guardarPreferencias(prefs: Preferencias): void {
  try {
    localStorage.setItem(GUARDADO, JSON.stringify(prefs));
  } catch {
    // Armazenamento cheio ou bloqueado. O tema do servidor continua valendo —
    // só o lampejo da abertura volta, e isso não justifica derrubar nada.
  }
}

export function lerPreferenciasGuardadas(): Preferencias {
  try {
    const bruto = localStorage.getItem(GUARDADO);
    if (!bruto) return PADRAO;

    return { ...PADRAO, ...(JSON.parse(bruto) as Partial<Preferencias>) };
  } catch {
    return PADRAO;
  }
}

/**
 * Acompanha o tema do aparelho enquanto a escolha for "seguir o sistema".
 *
 * Um tablet que escurece sozinho ao anoitecer deve levar o sistema junto — sem
 * isto, a preferência "SISTEMA" só valeria no instante da abertura.
 */
export function seguirTemaDoAparelho(prefs: Preferencias): () => void {
  if (prefs.theme !== "SISTEMA") return () => undefined;

  const consulta = window.matchMedia("(prefers-color-scheme: dark)");
  const aoMudar = () => aplicarPreferencias(prefs);

  consulta.addEventListener("change", aoMudar);
  return () => consulta.removeEventListener("change", aoMudar);
}
