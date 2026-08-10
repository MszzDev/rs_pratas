import type { Config } from "tailwindcss";

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
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
