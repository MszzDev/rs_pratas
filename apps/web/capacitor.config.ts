import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Como o tablet recebe atualização.
 *
 * Sem `CAP_SERVER_URL`, o aplicativo roda as telas empacotadas dentro do APK:
 * atualizar significa gerar um APK novo e instalar em cada tablet por cabo —
 * o que, com cinco quiosques espalhados pela cidade, é uma tarde de trabalho
 * para corrigir um botão.
 *
 * Com `CAP_SERVER_URL` apontando para o site publicado, o aplicativo carrega
 * as telas de lá. A parte nativa (quiosque, brilho, identidade do aparelho)
 * continua no APK e só muda quando ela mesma muda — o que é raro. Publicar o
 * site passa a atualizar os cinco tablets no próximo abrir.
 *
 * A troca não é de graça: o tablet passa a depender da internet para ABRIR,
 * não só para trabalhar. Na prática ele já dependia — sem rede não há preço,
 * estoque nem venda —, mas a falha fica mais visível: em vez de abrir e não
 * carregar dados, não abre.
 *
 * Compilar para produção:
 *   CAP_SERVER_URL=https://rs-pratas-web.onrender.com pnpm cap sync android
 */
const servidor = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.rspratas.app",
  appName: "RS Pratas",
  webDir: "dist",
  server: {
    androidScheme: "https",
    ...(servidor ? { url: servidor, cleartext: false } : {}),
  },
};

export default config;
