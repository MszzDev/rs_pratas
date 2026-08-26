import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "var(--cor-background)",
          secondary: "var(--cor-background-secondary)",
        },
        surface: "var(--cor-surface)",
        /**
         * O rosa do fundo da logo, medido do proprio arquivo.
         *
         * Serve para a logo nao aparecer como um quadrado colado sobre o
         * branco: onde ela esta, o fundo e o dela. Como e a cor que a marca ja
         * carrega, tambem apazigua o branco da barra lateral sem inventar um
         * tom novo.
         */
        brand: "var(--cor-brand)",
        rose: {
          primary: "var(--cor-rose-primary)",
          secondary: "var(--cor-rose-secondary)",
          dark: "var(--cor-rose-dark)",
          light: "var(--cor-rose-light)",
          soft: "var(--cor-rose-soft)",
        },
        text: {
          primary: "var(--cor-text-primary)",
          secondary: "var(--cor-text-secondary)",
          muted: "var(--cor-text-muted)",
        },
        /**
         * Acentos por área do sistema.
         *
         * Um vinho só em tudo deixava as telas iguais entre si: quem estava no
         * estoque e quem estava no caixa via a mesma tela cinza com um detalhe
         * vinho. Cada área ganhou um tom próprio, todos puxados para o lado
         * quente e dessaturado que combina com prata — nada de azul de sistema
         * operacional nem verde de planilha.
         *
         * O vinho continua sendo a cor da marca: é dele o botão principal, o
         * item ativo do menu e a logo. Os acentos identificam a área, não
         * competem com ele.
         */
        gold: { DEFAULT: "var(--cor-gold)", soft: "var(--cor-gold-soft)", dark: "var(--cor-gold-dark)" },
        sage: { DEFAULT: "var(--cor-sage)", soft: "var(--cor-sage-soft)", dark: "var(--cor-sage-dark)" },
        ocean: { DEFAULT: "var(--cor-ocean)", soft: "var(--cor-ocean-soft)", dark: "var(--cor-ocean-dark)" },
        plum: { DEFAULT: "var(--cor-plum)", soft: "var(--cor-plum-soft)", dark: "var(--cor-plum-dark)" },
        clay: { DEFAULT: "var(--cor-clay)", soft: "var(--cor-clay-soft)", dark: "var(--cor-clay-dark)" },

        border: "var(--cor-border)",
        success: "var(--cor-success)",
        warning: "var(--cor-warning)",
        danger: "var(--cor-danger)",
        info: "var(--cor-info)",
      },
      fontFamily: {
        sans: ["Inter", "Manrope", "Plus Jakarta Sans", "sans-serif"],
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.5rem",
        sm: "0.375rem",
      },
      /**
       * Sombras longas e muito claras. Num sistema que fica aberto o dia
       * inteiro num tablet, borda dura em toda caixa cansa a vista — a sombra
       * separa os blocos sem riscar a tela.
       */
      boxShadow: {
        soft: "0 18px 45px rgba(38, 35, 35, 0.07)",
        rose: "0 12px 30px rgba(155, 79, 83, 0.16)",
        lifted: "0 2px 6px rgba(38, 35, 35, 0.05), 0 12px 28px rgba(38, 35, 35, 0.06)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
