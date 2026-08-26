package com.rspratas.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.util.UUID;

/**
 * A impressora térmica do balcão.
 *
 * O cliente do quiosque quer o papel na mão. Comprovante por e-mail resolve o
 * arquivo, não resolve a fila: ninguém confere uma compra de trezentos reais
 * abrindo a caixa de entrada em pé na frente da loja.
 *
 * As impressoras que essas lojas usam são as de 58 mm de balcão, que falam
 * ESC/POS por Bluetooth clássico (perfil de porta serial). Este plugin faz
 * exatamente uma coisa: abrir a porta, despejar os bytes que a tela montou, e
 * fechar. Quem decide O QUE imprimir é o TypeScript — layout de comprovante é
 * assunto que muda toda semana, e recompilar o aplicativo para mexer numa
 * linha de rodapé seria o desenho errado.
 *
 * Uma conexão por impressão, sempre. Manter o socket aberto entre vendas
 * parece economia até a impressora ser desligada no fim do dia e o aplicativo
 * passar a falhar na manhã seguinte sem saber por quê.
 */
@CapacitorPlugin(
    name = "Impressora",
    permissions = {
      @Permission(
          alias = "bluetooth",
          strings = {Manifest.permission.BLUETOOTH_CONNECT})
    })
public class ImpressoraPlugin extends Plugin {

  /**
   * O endereço do perfil de porta serial, fixo no padrão Bluetooth.
   *
   * Toda impressora térmica de balcão o publica; é por ele que se conversa
   * ESC/POS sem driver nenhum.
   */
  private static final UUID PORTA_SERIAL =
      UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

  /** Antes do Android 12, a permissão de conexão era concedida na instalação. */
  private boolean precisaPedirPermissao() {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
  }

  private BluetoothAdapter adaptador() {
    BluetoothManager gerente =
        (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
    return gerente == null ? null : gerente.getAdapter();
  }

  /**
   * O que a tela pergunta antes de oferecer o botão de imprimir.
   *
   * Separa "este tablet não tem Bluetooth" de "o Bluetooth está desligado":
   * são problemas diferentes, e o segundo tem solução do outro lado do balcão.
   */
  @PluginMethod
  public void situacao(PluginCall call) {
    BluetoothAdapter adaptador = adaptador();

    JSObject resposta = new JSObject();
    resposta.put("temBluetooth", adaptador != null);
    resposta.put("ligado", adaptador != null && adaptador.isEnabled());
    resposta.put(
        "permitido",
        !precisaPedirPermissao() || getPermissionState("bluetooth") == com.getcapacitor.PermissionState.GRANTED);
    call.resolve(resposta);
  }

  /**
   * As impressoras já pareadas no Android.
   *
   * O pareamento em si continua sendo feito nas configurações do tablet, uma
   * vez por aparelho, por quem instala. Refazer aqui a busca e o pareamento
   * significaria pedir PIN de Bluetooth para a vendedora — e ela não deve nem
   * saber que existe um.
   */
  @PluginMethod
  public void listar(PluginCall call) {
    if (precisaPedirPermissao()
        && getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED) {
      requestPermissionForAlias("bluetooth", call, "permissaoRespondida");
      return;
    }

    entregarLista(call);
  }

  @PermissionCallback
  private void permissaoRespondida(PluginCall call) {
    if (getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED) {
      call.reject("SEM_PERMISSAO");
      return;
    }

    if ("imprimir".equals(call.getMethodName())) {
      executarImpressao(call);
      return;
    }

    entregarLista(call);
  }

  private void entregarLista(PluginCall call) {
    BluetoothAdapter adaptador = adaptador();

    if (adaptador == null) {
      call.reject("SEM_BLUETOOTH");
      return;
    }

    JSArray impressoras = new JSArray();

    try {
      for (BluetoothDevice aparelho : adaptador.getBondedDevices()) {
        JSObject item = new JSObject();
        item.put("nome", aparelho.getName() == null ? aparelho.getAddress() : aparelho.getName());
        item.put("endereco", aparelho.getAddress());
        impressoras.put(item);
      }
    } catch (SecurityException erro) {
      call.reject("SEM_PERMISSAO");
      return;
    }

    JSObject resposta = new JSObject();
    resposta.put("impressoras", impressoras);
    call.resolve(resposta);
  }

  /**
   * Manda os bytes para o papel.
   *
   * `conteudo` vem em base64 porque a ponte entre a tela e o Android carrega
   * texto, e ESC/POS não é texto: são bytes de comando misturados a bytes de
   * caracteres numa tabela que não é UTF-8. Passar isso como string faria a
   * ponte "corrigir" os acentos no caminho.
   */
  @PluginMethod
  public void imprimir(PluginCall call) {
    if (precisaPedirPermissao()
        && getPermissionState("bluetooth") != com.getcapacitor.PermissionState.GRANTED) {
      requestPermissionForAlias("bluetooth", call, "permissaoRespondida");
      return;
    }

    executarImpressao(call);
  }

  private void executarImpressao(PluginCall call) {
    String endereco = call.getString("endereco");
    String conteudo = call.getString("conteudo");

    if (endereco == null || conteudo == null) {
      call.reject("FALTAM_DADOS");
      return;
    }

    BluetoothAdapter adaptador = adaptador();

    if (adaptador == null) {
      call.reject("SEM_BLUETOOTH");
      return;
    }

    if (!adaptador.isEnabled()) {
      call.reject("BLUETOOTH_DESLIGADO");
      return;
    }

    // Em thread própria: abrir socket Bluetooth bloqueia por vários segundos
    // quando a impressora está desligada, e travar a tela do PDV nesse tempo
    // faria a vendedora tocar tudo de novo achando que não funcionou.
    new Thread(
            () -> {
              BluetoothSocket socket = null;

              try {
                BluetoothDevice impressora = adaptador.getRemoteDevice(endereco);
                socket = impressora.createRfcommSocketToServiceRecord(PORTA_SERIAL);

                // A busca por aparelhos, se estiver rodando, atrapalha a
                // conexão — é a recomendação do próprio Android.
                adaptador.cancelDiscovery();

                socket.connect();

                OutputStream saida = socket.getOutputStream();
                byte[] bytes = Base64.decode(conteudo, Base64.DEFAULT);

                // Em blocos: o buffer dessas impressoras é pequeno, e um
                // despejo único de vários kilobytes sai com linhas faltando.
                int inicio = 0;
                while (inicio < bytes.length) {
                  int tamanho = Math.min(256, bytes.length - inicio);
                  saida.write(bytes, inicio, tamanho);
                  saida.flush();
                  inicio += tamanho;
                  Thread.sleep(20);
                }

                // A impressora ainda está puxando papel quando o write termina.
                // Fechar o socket agora corta o fim do comprovante.
                Thread.sleep(400);

                JSObject resposta = new JSObject();
                resposta.put("impresso", true);
                call.resolve(resposta);
              } catch (SecurityException erro) {
                call.reject("SEM_PERMISSAO");
              } catch (Exception erro) {
                call.reject("FALHOU: " + erro.getMessage());
              } finally {
                if (socket != null) {
                  try {
                    socket.close();
                  } catch (Exception ignorado) {
                    // O socket já morreu junto com a falha que trouxe até aqui.
                  }
                }
              }
            },
            "impressao-rs-pratas")
        .start();
  }
}
