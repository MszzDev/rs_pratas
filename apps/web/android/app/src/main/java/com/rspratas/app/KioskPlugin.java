package com.rspratas.app;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ponte entre a tela e o confinamento do Android.
 *
 * A autorização para sair do quiosque acontece no servidor — permissão,
 * reautenticação e motivo, tudo auditado. Este plugin faz só a última etapa:
 * destravar o aparelho depois que o servidor já disse que pode.
 *
 * A ordem importa. Se o destrave viesse antes da autorização, bastaria
 * derrubar a rede para escapar do quiosque: sem servidor, sem negativa.
 */
@CapacitorPlugin(name = "Kiosk")
public class KioskPlugin extends Plugin {

  private DevicePolicyManager policy() {
    return (DevicePolicyManager) getContext().getSystemService(Context.DEVICE_POLICY_SERVICE);
  }

  /** A tela pergunta isto para saber se deve oferecer a saída. */
  @PluginMethod
  public void status(PluginCall call) {
    DevicePolicyManager policy = policy();
    boolean deviceOwner =
        policy != null && policy.isDeviceOwnerApp(getContext().getPackageName());

    JSObject resposta = new JSObject();
    resposta.put("deviceOwner", deviceOwner);
    // O estado do confinamento vem do ActivityManager, nao da Activity: quem
    // sabe se o aparelho esta preso e o sistema, nao a tela.
    ActivityManager gerente =
        (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
    boolean confinado =
        gerente != null && gerente.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;

    resposta.put("confinado", confinado);
    call.resolve(resposta);
  }

  /**
   * Sai do confinamento.
   *
   * Não é permanente: o `onResume` da MainActivity reentra no Lock Task assim
   * que o aplicativo volta ao primeiro plano. É essa a intenção — a saída serve
   * para um técnico mexer no aparelho agora, não para deixar o tablet solto
   * porque alguém esqueceu de trancar de volta.
   */
  @PluginMethod
  public void sair(PluginCall call) {
    DevicePolicyManager policy = policy();

    if (policy == null || !policy.isDeviceOwnerApp(getContext().getPackageName())) {
      // Sem Device Owner o aparelho nunca esteve confinado. Resolver em vez de
      // rejeitar: para quem chamou, o resultado desejado já vale.
      call.resolve(new JSObject().put("saiu", false).put("motivo", "sem-device-owner"));
      return;
    }

    getActivity()
        .runOnUiThread(
            () -> {
              try {
                // Avisa a Activity para nao reentrar no confinamento no proximo
                // onResume — senao a saida duraria ate o tecnico trocar de app.
                ((MainActivity) getActivity()).marcarSaidaAutorizada();
                getActivity().stopLockTask();
                call.resolve(new JSObject().put("saiu", true));
              } catch (IllegalStateException erro) {
                call.reject("Não foi possível sair do modo quiosque.", erro);
              }
            });
  }

  /**
   * Devolve o aparelho de vez: remove a administração.
   *
   * Depois disto o tablet volta a ser um tablet comum e o modo quiosque só
   * retorna com um novo provisionamento — que exige formatar. Por isso está
   * separado de `sair`, e a tela pede confirmação à parte.
   */
  @PluginMethod
  public void desprovisionar(PluginCall call) {
    DevicePolicyManager policy = policy();

    if (policy == null || !policy.isDeviceOwnerApp(getContext().getPackageName())) {
      call.resolve(new JSObject().put("removido", false));
      return;
    }

    policy.clearDeviceOwnerApp(getContext().getPackageName());
    call.resolve(new JSObject().put("removido", true));
  }
}
