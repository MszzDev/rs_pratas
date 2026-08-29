/**
 * Service worker do RS Pratas — de propósito, ele NÃO guarda nada.
 *
 * Existe por um motivo só: sem service worker o navegador não oferece
 * "Instalar", e instalar é o que dá janela própria, ícone na área de trabalho e
 * no celular, e o comportamento de aplicativo que o dono pediu.
 *
 * O que ele NÃO faz é igualmente deliberado. Um service worker comum guarda as
 * telas para abrir rápido e funcionar sem internet — e é exatamente assim que
 * se cria o problema que estamos resolvendo: a versão velha fica guardada, e a
 * pessoa aperta F5 sem parar porque a atualização não chega.
 *
 * Este sistema já tem um jeito de saber quando há versão nova: o verificador
 * compara o nome do pacote publicado com o carregado, a cada três minutos, e
 * recarrega quando não há nada a perder na tela. Guardar as telas aqui criaria
 * uma SEGUNDA opinião sobre qual é a versão atual — e as duas discordariam,
 * com a do cache ganhando.
 *
 * Então tudo passa direto para a rede. Sem `fetch` interceptado, sem cache.
 *
 * A consequência honesta: instalado, o sistema continua precisando de
 * internet. Ele já precisava — sem rede não há preço, estoque nem venda —, e
 * fingir que abre offline mostraria uma tela vazia em vez de dizer o que houve.
 */

// Assume o controle assim que instala, sem esperar as abas antigas fecharem.
// Um service worker que só entra em vigor "na próxima vez" é mais uma coisa
// com estado que ninguém consegue explicar depois.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      /**
       * Limpa cache de versões anteriores deste arquivo.
       *
       * Se algum dia alguém publicar aqui um service worker que guarda coisas,
       * e depois voltar atrás, os arquivos guardados continuariam servindo
       * telas velhas para sempre — porque um service worker sem `fetch` não
       * apaga o que o anterior deixou.
       */
      const nomes = await caches.keys();
      await Promise.all(nomes.map((nome) => caches.delete(nome)));

      await self.clients.claim();
    })(),
  );
});
