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
