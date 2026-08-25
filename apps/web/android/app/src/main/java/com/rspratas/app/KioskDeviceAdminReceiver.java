package com.rspratas.app;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Receptor de administrador do dispositivo.
 *
 * Existe para que o tablet possa ser atribuído como Device Owner:
 *
 *   adb shell dpm set-device-owner com.rspratas.app/.KioskDeviceAdminReceiver
 *
 * Sem essa atribuição, o Android só permite o Lock Task Mode com uma
 * confirmação do usuário na tela — o que derrota o propósito, porque o
 * vendedor poderia simplesmente recusar. Device Owner é o que torna o
 * confinamento efetivo, e ele só se atribui num aparelho recém-formatado, sem
 * conta Google configurada.
 *
 * A classe é praticamente vazia de propósito. O que importa é ela EXISTIR e
 * estar declarada no manifesto: é o endereço que o comando de provisionamento
 * procura.
 */
public class KioskDeviceAdminReceiver extends DeviceAdminReceiver {

  private static final String TAG = "RSPratasKiosk";

  @Override
  public void onEnabled(Context context, Intent intent) {
    super.onEnabled(context, intent);
    Log.i(TAG, "RS Pratas atribuido como administrador do dispositivo.");
  }

  /**
   * Chamado quando alguém tenta remover a administração.
   *
   * O texto volta para a tela do sistema, então precisa explicar a consequência
   * para quem estiver com o tablet na mão — normalmente alguém do balcão, não
   * um técnico.
   */
  @Override
  public CharSequence onDisableRequested(Context context, Intent intent) {
    return "Remover a administracao libera o tablet para sair do RS Pratas. "
        + "Faca isso apenas se o aparelho for deixar de ser um caixa da loja.";
  }

  @Override
  public void onDisabled(Context context, Intent intent) {
    super.onDisabled(context, intent);
    Log.w(TAG, "Administracao removida — o modo quiosque deixa de valer.");
  }
}
