# Modo quiosque no tablet Android

O tablet da loja precisa abrir direto no RS Pratas e não permitir que o vendedor
saia para Home, Recentes, Chrome, Play Store ou Configurações.

## O que o aplicativo faz sozinho

`apps/web/src/lib/kiosk.ts` aplica reforços do lado do app:

- botão voltar não encerra o aplicativo na tela inicial;
- menu de contexto e seleção por toque longo desativados;
- conteúdo ocultado quando o app vai para segundo plano, para não aparecer na
  miniatura da lista de recentes.

**Nada disso é uma trava de segurança.** São medidas contra saída acidental. Um
usuário determinado contorna todas elas.

## O que exige configuração do sistema

O confinamento real depende do **Lock Task Mode** do Android, e ele só pode ser
ativado sem confirmação do usuário se o aplicativo for **Device Owner**. Isso
não se instala pela Play Store nem se ativa por código do app: é feito no
provisionamento do aparelho.

### Provisionamento (uma vez por tablet, com o aparelho zerado)

1. Restaurar o tablet para o padrão de fábrica.
2. **Não** adicionar nenhuma conta Google durante a configuração inicial — a
   presença de uma conta impede a atribuição de Device Owner.
3. Instalar o APK do RS Pratas via ADB.
4. Atribuir o Device Owner:

```bash
adb shell dpm set-device-owner com.rspratas.app/.KioskDeviceAdminReceiver
```

5. Confirmar:

```bash
adb shell dumpsys device_policy | grep -i "device owner"
```


### Gerar o APK

```bash
pnpm turbo run build --filter=@rs-pratas/web
cd apps/web && pnpm exec cap sync android
cd android && ./gradlew assembleDebug
```

O arquivo sai em `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`.

O `local.properties` com o caminho do SDK **não** vai para o Git — cada máquina
tem o seu, e o arquivo já está no `.gitignore`.

## O que já está implementado no nativo

`MainActivity` entra no Lock Task ao abrir **e ao voltar do segundo plano**. A
segunda chamada não é redundante: uma atualização do sistema ou um encerramento
forçado tira o aparelho do confinamento, e sem reentrar o tablet ficaria solto
sem que ninguém percebesse — a tela continua a mesma.

Quando o aplicativo **não** é Device Owner, ele roda normalmente e apenas não
confina. Essa escolha é deliberada: um tablet de vitrine, o celular do gerente
ou um aparelho de teste continuam usáveis, e a loja não fica sem PDV porque o
provisionamento não foi feito.

`FLAG_SECURE` está ativo na Activity inteira: o Android não fotografa a tela
para a lista de recentes nem permite captura. O resumo do caixa não fica
visível na miniatura para quem pegar o tablet.

O aplicativo também se declara como tela inicial (`category.HOME`). Com Device
Owner, ligar o tablet cai direto no PDV e o botão Home volta para cá em vez de
sair.

## O que ainda falta

| Item | Situação |
|---|---|
| Reforços no app (voltar, contexto, segundo plano) | Pronto |
| Autorização de saída no backend (permissão + step-up + auditoria) | Pronto |
| `KioskDeviceAdminReceiver` e Lock Task Mode | Pronto |
| `FLAG_SECURE` | Pronto |
| App como tela inicial | Pronto |
| Interface dos 5 toques para sair | Pendente |
| Provisionamento num tablet real | Pendente — exige o aparelho |

A saída do quiosque exige, pela especificação: 5 toques na logo, login,
permissão `DEVICE_EXIT_KIOSK`, reautenticação com propósito `EXIT_KIOSK`,
confirmação e motivo. **O backend já faz toda a parte de autorização.** Falta a
interface dos 5 toques chamando `stopLockTask()`.

Toda saída gera `AuditLog(DEVICE_KIOSK_EXIT)` com o motivo.

## Aviso honesto

Nada disto foi testado num tablet físico — não havia aparelho. O que está
verificado é que o APK **compila** e que o receptor, a permissão de
administrador, a categoria HOME e o retorno após reinício estão dentro do
pacote gerado (conferido no manifesto compilado com `aapt2`).

O comportamento do Lock Task só se confirma no aparelho, depois do
provisionamento.
