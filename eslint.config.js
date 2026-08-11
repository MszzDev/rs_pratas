import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/android/**",
      "**/prisma/migrations/**",
      /**
       * O vitest cria um arquivo temporário ao lado do próprio config ao
       * carregá-lo, e o apaga logo depois. Como o turbo roda lint e test em
       * paralelo, o eslint às vezes o encontra no instante em que ele some e
       * quebra com ENOENT — falha intermitente que não diz nada sobre o código.
       */
      "**/*.timestamp-*.mjs",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      // Um `await` esquecido numa rotina de auditoria ou de transação passa
      // despercebido e só aparece como registro faltando em produção.
      "no-console": ["warn", { allow: ["error", "warn"] }],
      eqeqeq: ["error", "smart"],
    },
  },

  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  {
    // O seed e os scripts de teste imprimem no console de propósito.
    files: ["apps/api/prisma/seed.ts", "apps/api/test/**/*.ts"],
    rules: { "no-console": "off" },
  },
);
