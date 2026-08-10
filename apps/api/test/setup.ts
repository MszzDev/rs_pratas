import { config } from "dotenv";

// Precisa rodar ANTES de qualquer import que leia process.env (src/config/env.ts
// valida o ambiente no momento do import). Por isso este arquivo é registrado
// como `setupFiles` no vitest.config.ts.
config({ path: ".env.test", override: true });
