# Como atualizar os tablets

Cinco quiosques espalhados pela cidade, cada um com um tablet em modo quiosque.
Este documento é sobre o que acontece quando uma correção precisa chegar neles.

## O problema

O aplicativo do tablet é um APK. Do jeito tradicional, atualizar significa:
gerar o APK, ir até cada loja, ligar o cabo, instalar. Uma correção de um botão
vira uma tarde de trabalho e cinco viagens — e, na prática, significa que
correções pequenas simplesmente não chegam.

## A solução adotada

As telas do sistema não moram dentro do APK: moram no site publicado, e o APK
as carrega de lá. Publicar o site atualiza os cinco tablets no próximo abrir.

O que continua dentro do APK é só a parte nativa — modo quiosque, brilho,
identidade do aparelho, saída pelos cinco toques. Isso muda raramente, e é a
única situação que ainda exige o cabo.

### Compilando o APK dos tablets

```bash
cd apps/web
CAP_SERVER_URL=https://rs-pratas-web.onrender.com pnpm cap sync android
cd android && ./gradlew assembleDebug
```

Sem a variável `CAP_SERVER_URL`, o APK é gerado com as telas embutidas — que é
o que se quer para testar uma versão local antes de publicar.

### O tablet descobrindo sozinho que há versão nova

Publicar o site não bastava. O WebView do Android guarda o documento principal
no cache dele e **não o revalida** — nem reiniciar o aplicativo bastava. O
tablet ficava numa versão antiga sem nada na tela dizendo isso, e a diferença
só aparecia quando alguém procurava uma tela nova e não achava. Foi
exatamente o que aconteceu com o envio por QR Code.

O aplicativo agora confere por conta própria: busca o `index.html` publicado
sem cache e compara o nome do pacote (`index-Dxi_Ixmc.js`) com o que está
carregado. Diferente, há versão nova.

Quando ele troca:

- **Sozinho**, se a pessoa estiver na tela de entrada (`/pin`, `/login`) — ali
  não há nada a perder.
- **Perguntando**, se ela estiver no meio de alguma coisa. Recarregar durante
  uma venda apagaria o carrinho, então o aviso espera num canto.

A conferência acontece ao abrir, a cada volta do segundo plano, e de quinze em
quinze minutos.

A recarga usa um endereço com carimbo de tempo, e não `location.reload()`: o
reload comum volta a pedir a mesma URL, e o WebView responde do mesmo cache
que criou o problema.

### O que isso custa

O tablet passa a precisar de internet para **abrir**, não só para trabalhar.
Na prática ele já precisava: sem rede não há preço, estoque nem venda. O que
muda é a forma da falha — em vez de abrir e não carregar os dados, ele não
abre. Uma queda de internet na loja para o expediente de qualquer maneira.

### Quando ainda é preciso o cabo

- Mudança em código nativo (`android/`): quiosque, brilho, plugin.
- Troca de permissão no `AndroidManifest.xml`.
- Primeira instalação num tablet novo — que é também quando se faz o
  provisionamento de Device Owner, e o aparelho precisa estar em mãos de todo
  jeito.

## Instalando pela primeira vez

O passo a passo do provisionamento (formatar, ativar depuração, tornar o
aplicativo Device Owner) está em [quiosque-android.md](./quiosque-android.md).
