package com.rspratas.app;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
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

  /**
   * Quando a saída autorizada foi feita, em milissegundos.
   *
   * O `onResume` reentra no confinamento — é isso que impede o tablet de ficar
   * solto se alguém trocar de app e voltar. Só que, logo após uma saída
   * legítima, esse mesmo comportamento trancaria o técnico para fora do que ele
   * acabou de ser autorizado a fazer. A janela abaixo é a trégua.
   */
  private long saiuEm = 0L;

  /** Tempo de trégua depois de uma saída autorizada. */
  private static final long TREGUA_MS = 5 * 60 * 1000;

  /**
   * Aplicativos do fabricante que abrem porta para fora do quiosque.
   *
   * A Lenovo instala uma barra lateral de janelas flutuantes: tres pontinhos
   * no alto que abrem outros aplicativos POR CIMA do nosso. O Lock Task nao
   * alcanca isso — ele governa a troca de tarefa, e a barra do fabricante nao
   * troca de tarefa, ela sobrepoe.
   *
   * A lista existe porque cada marca tem a sua invencao. Se um tablet novo
   * trouxer outra, o nome do pacote entra aqui.
   */
  private static final String[] SOBREPOSICOES_DO_FABRICANTE = {
    "com.zui.freeform.sidebar",
  };

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // ANTES do super.onCreate: e ele quem monta a ponte com a tela. Registrar
    // depois compila e nao reclama, mas a ponte ja nasceu sem o plugin, e a
    // tela recebe "Kiosk plugin is not implemented on android" — que foi
    // exatamente o que aconteceu com a saida do quiosque e com o anuncio do
    // aparelho.
    registerPlugin(KioskPlugin.class);
    registerPlugin(ImpressoraPlugin.class);

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

    if (System.currentTimeMillis() - saiuEm < TREGUA_MS) {
      Log.i(TAG, "Saida autorizada recente — nao reentrando no confinamento.");
      return;
    }

    entrarNoModoQuiosque();
  }

  /** Chamado pelo plugin quando a saída foi autorizada pelo servidor. */
  void marcarSaidaAutorizada() {
    saiuEm = System.currentTimeMillis();
  }

  /**
   * Esconde as barras do sistema e as mantem escondidas.
   *
   * IMMERSIVE_STICKY faz elas voltarem sozinhas depois de um deslize, em vez
   * de ficarem visiveis ate alguem toca-las de novo. Sem o STICKY, um deslize
   * acidental deixaria a barra na tela pelo resto do expediente.
   */
  private void esconderBarrasDoSistema() {
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
  }

  /**
   * O Android devolve as barras quando a janela recupera o foco. Sem reesconder
   * aqui, elas reapareceriam a cada dialogo do sistema ou volta de teclado.
   */
  @Override
  public void onWindowFocusChanged(boolean temFoco) {
    super.onWindowFocusChanged(temFoco);
    if (temFoco) esconderBarrasDoSistema();
  }

  /**
   * Esconde os aplicativos do fabricante que furam o confinamento.
   *
   * setApplicationHidden e reversivel e so vale enquanto somos Device Owner:
   * removida a administracao, a barra do fabricante volta. E o comportamento
   * certo — o tablet que deixa de ser caixa deve voltar a ser um tablet.
   */
  /**
   * Torna o RS Pratas a tela inicial permanente.
   *
   * Declarar CATEGORY_HOME no manifesto só faz o aplicativo APARECER na lista
   * de candidatos — o Android continua abrindo o launcher do fabricante, que
   * já era o padrão. Era por isso que o tablet caía na tela da Lenovo a cada
   * reinício, mesmo com tudo o mais configurado.
   *
   * `addPersistentPreferredActivity` resolve a escolha de uma vez: enquanto
   * formos Device Owner, HOME é aqui. É o que faz ligar o tablet cair direto
   * no PDV, sem ninguém tocar em nada.
   */
  private void assumirTelaInicial(DevicePolicyManager policy, ComponentName admin) {
    IntentFilter filtro = new IntentFilter(Intent.ACTION_MAIN);
    filtro.addCategory(Intent.CATEGORY_HOME);
    filtro.addCategory(Intent.CATEGORY_DEFAULT);

    try {
      policy.addPersistentPreferredActivity(
          admin, filtro, new ComponentName(this, MainActivity.class));
    } catch (Exception erro) {
      Log.w(TAG, "Nao assumiu a tela inicial: " + erro.getMessage());
    }
  }

  private void esconderSobreposicoesDoFabricante(
      DevicePolicyManager policy, ComponentName admin) {
    for (String pacote : SOBREPOSICOES_DO_FABRICANTE) {
      try {
        policy.setApplicationHidden(admin, pacote, true);
      } catch (Exception erro) {
        // O pacote nao existe neste aparelho, ou o sistema recusou. Nenhum dos
        // dois justifica impedir o PDV de abrir.
        Log.i(TAG, "Nao escondeu " + pacote + ": " + erro.getMessage());
      }
    }
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

    // Desliga TUDO que o sistema ofereceria durante o confinamento.
    //
    // LOCK_TASK_FEATURE_NONE e o que fecha a ultima porta: sem ele, o Android
    // mantem as notificacoes e a barra de informacoes acessiveis por um
    // deslize, mesmo com o aplicativo preso em primeiro plano. O Lock Task
    // sozinho impede TROCAR de app; ele nao impede ABRIR a gaveta do sistema.
    //
    // Precisa vir ANTES do startLockTask: aplicado depois, so vale no proximo
    // confinamento, e o de agora fica com o padrao permissivo.
    try {
      policy.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
    } catch (SecurityException | IllegalArgumentException erro) {
      Log.w(TAG, "Nao foi possivel restringir os recursos do sistema: " + erro.getMessage());
    }

    // Reforco separado, para quando o aparelho NAO estiver em Lock Task —
    // entre o boot e o startLockTask, por exemplo.
    try {
      policy.setStatusBarDisabled(admin, true);
    } catch (SecurityException erro) {
      Log.w(TAG, "Nao foi possivel desligar a barra de status: " + erro.getMessage());
    }

    esconderBarrasDoSistema();
    esconderSobreposicoesDoFabricante(policy, admin);
    assumirTelaInicial(policy, admin);

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
