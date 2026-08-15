import { cn } from "@/lib/utils";

/**
 * Marca RS Pratas.
 *
 * O monograma é um losango — a forma de uma pedra lapidada vista de frente —
 * com as facetas desenhadas em tons de rosa. Dentro dele, "RS" em serifa.
 *
 * SVG e não imagem: a marca aparece no login, na barra lateral, no
 * comprovante impresso e vai aparecer na etiqueta. Cada um desses lugares
 * pede um tamanho diferente, e um PNG que serve para a barra lateral fica
 * borrado no comprovante. Além disso o tablet baixa o app por uma rede de
 * shopping — meia dúzia de bytes de vetor pesa menos que qualquer arquivo.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("h-8 w-8", className)}
      role="img"
      aria-label="RS Pratas"
    >
      <defs>
        <linearGradient id="rsGemLight" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C98F93" />
          <stop offset="100%" stopColor="#9B4F53" />
        </linearGradient>
        <linearGradient id="rsGemDeep" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9B4F53" />
          <stop offset="100%" stopColor="#6E3437" />
        </linearGradient>
      </defs>

      {/* Coroa da pedra: as facetas de cima, mais claras. */}
      <path d="M24 3 L44 18 L24 18 Z" fill="url(#rsGemLight)" />
      <path d="M24 3 L4 18 L24 18 Z" fill="url(#rsGemLight)" opacity="0.75" />

      {/* Pavilhão: as facetas de baixo, que convergem na ponta. */}
      <path d="M4 18 L24 45 L24 18 Z" fill="url(#rsGemDeep)" opacity="0.9" />
      <path d="M44 18 L24 45 L24 18 Z" fill="url(#rsGemDeep)" />

      {/* Linha da cintura — o que faz a pedra parecer lapidada e não um losango. */}
      <path
        d="M4 18 H44"
        stroke="#F4E8E9"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path d="M24 3 V45" stroke="#F4E8E9" strokeWidth="0.7" opacity="0.35" />

      {/* Brilho: o ponto de luz que toda peça de vitrine tem na foto. */}
      <path d="M14 10.5 L18.5 7 L20 8.5 L15.5 12 Z" fill="#FFFFFF" opacity="0.55" />
    </svg>
  );
}

/**
 * Marca completa: monograma + nome.
 *
 * `RS` em peso alto e `PRATAS` espaçado embaixo — a hierarquia que uma
 * joalheria usa na fachada, onde a sigla é o que se lê de longe.
 */
export function Logo({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const marks = { sm: "h-7 w-7", md: "h-9 w-9", lg: "h-14 w-14" };
  const names = { sm: "text-base", md: "text-lg", lg: "text-3xl" };
  const tags = { sm: "text-[0.5rem]", md: "text-[0.55rem]", lg: "text-[0.7rem]" };

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark className={marks[size]} />

      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "font-semibold tracking-tight text-rose-primary",
            names[size],
          )}
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          RS Pratas
        </span>
        <span
          className={cn(
            "mt-0.5 font-medium uppercase tracking-[0.32em] text-text-muted",
            tags[size],
          )}
        >
          Prata 925
        </span>
      </span>
    </span>
  );
}
