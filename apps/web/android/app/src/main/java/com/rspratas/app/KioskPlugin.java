package com.rspratas.app;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;

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
   * Identificacao do aparelho, para ele se anunciar ao sistema.
   *
   * ANDROID_ID e estavel enquanto o aparelho nao for formatado — o que e
   * exatamente a vida util de um tablet de balcao. Um identificador que
   * mudasse a cada atualizacao faria o mesmo tablet reaparecer na fila do
   * dono como se fosse novo.
   */
  @PluginMethod
  public void identidade(PluginCall call) {
    String androidId =
        Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);

    JSObject resposta = new JSObject();
    resposta.put("hardwareId", androidId);
    resposta.put("model", Build.MANUFACTURER + " " + Build.MODEL);
    resposta.put("osVersion", "Android " + Build.VERSION.RELEASE);
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
   * Brilho da tela, ajustado pelo proprio sistema.
   *
   * Com a barra do Android desligada, nao ha mais como puxar o painel de
   * ajustes rapidos — e o balcao da joalheria vai do sol da vitrine as seis da
   * tarde. Sem isto, a vendedora fica sem saida quando a tela apaga na luz.
   *
   * O ajuste e da JANELA do aplicativo, nao do sistema: nao exige a permissao
   * WRITE_SETTINGS e nao mexe no brilho de nada mais no aparelho.
   *
   * O minimo e 0,05 e nao zero: brilho zero apaga a tela por completo, e a
   * pessoa que arrastasse ate o fim ficaria sem enxergar o proprio controle
   * para voltar.
   */
  @PluginMethod
  public void definirBrilho(PluginCall call) {
    Float nivel = call.getFloat("nivel");

    if (nivel == null) {
      call.reject("Informe o nível do brilho, entre 0 e 1.");
      return;
    }

    final float ajustado = Math.max(0.05f, Math.min(1f, nivel));

    getActivity()
        .runOnUiThread(
            () -> {
              WindowManager.LayoutParams atributos = getActivity().getWindow().getAttributes();
              atributos.screenBrightness = ajustado;
              getActivity().getWindow().setAttributes(atributos);
              call.resolve(new JSObject().put("nivel", ajustado));
            });
  }

  /** O brilho atual da janela. Negativo significa "o que o sistema mandar". */
  @PluginMethod
  public void obterBrilho(PluginCall call) {
    float atual = getActivity().getWindow().getAttributes().screenBrightness;
    call.resolve(new JSObject().put("nivel", atual));
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
