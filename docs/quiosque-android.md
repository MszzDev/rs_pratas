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

### Implementação nativa pendente

Falta escrever, em `apps/web/android`:

- `KioskDeviceAdminReceiver` (subclasse de `DeviceAdminReceiver`);
- chamada de `startLockTask()` na `MainActivity`;
- `setLockTaskPackages()` para autorizar o próprio pacote;
- plugin Capacitor expondo `enterKiosk()` / `exitKiosk()` ao TypeScript;
- desabilitar a barra de status e a navegação por gestos via
  `DevicePolicyManager.setStatusBarDisabled()` e `setKeyguardDisabled()`.

## Saída do quiosque

Pela especificação, sair exige: 5 toques na logo, login, permissão
`DEVICE_EXIT_KIOSK`, reautenticação (step-up com propósito `EXIT_KIOSK`),
confirmação e motivo. O backend já implementa a parte de autorização — o
`requireStepUp(EXIT_KIOSK)` e a permissão existem. Falta a interface dos 5
toques e a chamada nativa de `stopLockTask()`.

Toda saída precisa gerar `AuditLog(DEVICE_KIOSK_EXIT)` com o motivo informado.

## Bloqueio de captura de tela

Telas com credenciais e dados administrativos devem chamar
`getWindow().setFlags(FLAG_SECURE, FLAG_SECURE)` na Activity. Ainda não
implementado.

## Estado atual

| Item | Situação |
|---|---|
| Reforços no app (voltar, contexto, segundo plano) | Implementado |
| Autorização de saída no backend (permissão + step-up + auditoria) | Implementado |
| Lock Task Mode / Device Owner | Pendente — requer código nativo |
| Interface dos 5 toques | Pendente |
| FLAG_SECURE em telas sensíveis | Pendente |
