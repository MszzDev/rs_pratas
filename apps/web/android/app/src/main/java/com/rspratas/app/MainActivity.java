package com.rspratas.app;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Tela única do aplicativo, com o confinamento de quiosque.
 *
 * O Lock Task Mode prende o tablet neste aplicativo: Home, Recentes e a barra
 * de status deixam de responder. Ele só entra sem pedir confirmação se o
 * aplicativo for Device Owner — atribuição feita uma vez por aparelho, no
 * provisionamento (ver docs/quiosque-android.md).
 *
 * Sem essa atribuição, o aplicativo funciona normalmente e apenas NÃO confina.
 * Essa é a escolha certa: um tablet de vitrine, um celular do gerente ou um
 * aparelho de teste continuam usáveis, e a loja não fica sem sistema porque o
 * provisionamento não foi feito.
 */
public class MainActivity extends BridgeActivity {

  private static final String TAG = "RSPratasKiosk";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Impede que o Android fotografe a tela para a lista de recentes e para
    // capturas: o resumo do caixa não pode ficar visível na miniatura para
    // quem pegar o tablet.
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

    // A tela não apaga durante o expediente. Num caixa, a tela apagando entre
    // um cliente e outro obriga a desbloquear a cada venda.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    entrarNoModoQuiosque();
  }

  /**
   * Reentra no confinamento quando o aplicativo volta ao primeiro plano.
   *
   * Uma atualização do sistema ou um encerramento forçado tira o aparelho do
   * Lock Task. Sem esta chamada, o tablet ficaria "solto" até alguém reiniciar
   * o aplicativo — e ninguém perceberia, porque a tela continua a mesma.
   */
  @Override
  public void onResume() {
    super.onResume();
    entrarNoModoQuiosque();
  }

  private void entrarNoModoQuiosque() {
    DevicePolicyManager policy =
        (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);

    if (policy == null) return;

    ComponentName admin = new ComponentName(this, KioskDeviceAdminReceiver.class);

    if (!policy.isDeviceOwnerApp(getPackageName())) {
      Log.i(TAG, "Sem Device Owner — o aplicativo roda sem confinar o aparelho.");
      return;
    }

    // Autoriza este pacote a usar o Lock Task. Sem isto, startLockTask()
    // mostraria a confirmação do sistema, que o vendedor poderia recusar.
    policy.setLockTaskPackages(admin, new String[] {getPackageName()});

    try {
      startLockTask();
      Log.i(TAG, "Modo quiosque ativo.");
    } catch (IllegalArgumentException erro) {
      // Já está em Lock Task, ou o sistema recusou. Nenhum dos dois justifica
      // derrubar o aplicativo e deixar a loja sem PDV.
      Log.w(TAG, "Nao foi possivel entrar no modo quiosque: " + erro.getMessage());
    }
  }
}
