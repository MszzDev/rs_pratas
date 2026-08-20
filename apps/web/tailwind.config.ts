import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "#FFFFFF",
          secondary: "#F8F7F7",
        },
        surface: "#FFFFFF",
        rose: {
          primary: "#9B4F53",
          secondary: "#A85D62",
          dark: "#7C3D41",
          light: "#C98F93",
          soft: "#F4E8E9",
        },
        text: {
          primary: "#262323",
          secondary: "#6F6868",
          muted: "#A6A0A0",
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
        gold: { DEFAULT: "#B8873B", soft: "#FBF1DF", dark: "#8A6423" },
        sage: { DEFAULT: "#4F7D63", soft: "#E6F0E9", dark: "#3A5F4A" },
        ocean: { DEFAULT: "#3F6C8F", soft: "#E4EDF4", dark: "#2E5069" },
        plum: { DEFAULT: "#7A5080", soft: "#F0E7F1", dark: "#5C3B61" },
        clay: { DEFAULT: "#A45D45", soft: "#F7E9E3", dark: "#7C4432" },

        border: "#E7DFE0",
        success: "#2E7D5B",
        warning: "#C88A2C",
        danger: "#C74747",
        info: "#4176A8",
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
