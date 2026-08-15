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
