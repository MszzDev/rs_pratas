package com.rspratas.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
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
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.UUID;

/**
 * A impressora térmica do balcão.
 *
 * O cliente do quiosque quer o papel na mão. Comprovante por e-mail resolve o
 * arquivo, não resolve a fila: ninguém confere uma compra de trezentos reais
 * abrindo a caixa de entrada em pé na frente da loja.
 *
 * Todas falam a mesma língua — ESC/POS —, e o que muda é só por onde os bytes
 * entram. São três caminhos:
 *
 * - BLUETOOTH, pelo perfil de porta serial. Sem fio, uma impressora por
 *   tablet, e depende de pareamento feito uma vez nas configurações.
 * - REDE, na porta 9100. O mais robusto para um balcão: uma impressora atende
 *   vários aparelhos e nada se perde se alguém desligar o Bluetooth.
 * - USB, pelo cabo. Sem driver: o aplicativo acha a interface de impressora e
 *   escreve nela.
 *
 * Este plugin faz exatamente uma coisa em qualquer um deles: abrir a porta,
 * despejar os bytes que a tela montou, e fechar. Quem decide O QUE imprimir é
 * o TypeScript — layout de comprovante é assunto que muda toda semana, e
 * recompilar o aplicativo para mexer numa linha de rodapé seria o desenho
 * errado.
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
   * Despeja os bytes na porta, seja ela qual for.
   *
   * Em blocos de 256 e com uma pausa curta: o buffer dessas impressoras é
   * pequeno, e um despejo único de vários kilobytes sai com linhas faltando.
   * A pausa final existe porque a impressora ainda está puxando papel quando o
   * write termina — fechar agora cortaria o fim do comprovante.
   */
  private void despejar(OutputStream saida, byte[] bytes) throws Exception {
    int inicio = 0;
    while (inicio < bytes.length) {
      int tamanho = Math.min(256, bytes.length - inicio);
      saida.write(bytes, inicio, tamanho);
      saida.flush();
      inicio += tamanho;
      Thread.sleep(20);
    }
    Thread.sleep(400);
  }

  /**
   * Impressora ligada na REDE.
   *
   * Praticamente toda térmica com porta Ethernet — a Elgin L42 entre elas —
   * escuta ESC/POS cru na porta 9100, o padrão que a indústria herdou das
   * impressoras de rede antigas. Não há driver, protocolo nem autenticação: os
   * mesmos bytes que vão pelo Bluetooth vão por aqui.
   *
   * É o caminho mais robusto dos três para um balcão: não depende de
   * pareamento, não some quando alguém desliga o Bluetooth do tablet sem
   * querer, e UMA impressora atende vários aparelhos da mesma loja.
   *
   * A espera é curta de propósito. Impressora desligada ou IP errado são o caso
   * comum, e são erros de configuração — quem está no balcão precisa da
   * resposta rápida para tentar de novo, não de trinta segundos de tela parada.
   */
  @PluginMethod
  public void imprimirNaRede(PluginCall call) {
    String ip = call.getString("ip");
    String conteudo = call.getString("conteudo");
    Integer porta = call.getInt("porta", 9100);

    if (ip == null || conteudo == null) {
      call.reject("FALTAM_DADOS");
      return;
    }

    new Thread(
            () -> {
              try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(ip, porta == null ? 9100 : porta), 5000);
                despejar(socket.getOutputStream(), Base64.decode(conteudo, Base64.DEFAULT));

                JSObject resposta = new JSObject();
                resposta.put("impresso", true);
                call.resolve(resposta);
              } catch (Exception erro) {
                call.reject("REDE_FALHOU: " + erro.getMessage());
              }
            },
            "impressao-rede")
        .start();
  }

  /** A interface de impressora do aparelho USB, ou nulo se ele não for uma. */
  private UsbInterface interfaceDeImpressora(UsbDevice aparelho) {
    for (int i = 0; i < aparelho.getInterfaceCount(); i += 1) {
      UsbInterface face = aparelho.getInterface(i);
      if (face.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return face;
    }
    return null;
  }

  /**
   * Impressoras ligadas no cabo USB.
   *
   * O Android entrega o aparelho cru, sem driver: é o aplicativo que precisa
   * achar a interface de impressora (classe 7 do padrão USB) e escrever nela.
   * Quem não tem essa interface não é impressora, e nem aparece na lista.
   */
  @PluginMethod
  public void listarUsb(PluginCall call) {
    UsbManager gerente = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);

    JSArray impressoras = new JSArray();

    if (gerente != null) {
      for (UsbDevice aparelho : gerente.getDeviceList().values()) {
        if (interfaceDeImpressora(aparelho) == null) continue;

        JSObject item = new JSObject();
        item.put(
            "nome",
            aparelho.getProductName() == null
                ? "Impressora USB"
                : aparelho.getProductName());
        // O nome do dispositivo se mantém entre conexões; o id numérico não.
        item.put("endereco", aparelho.getDeviceName());
        impressoras.put(item);
      }
    }

    JSObject resposta = new JSObject();
    resposta.put("impressoras", impressoras);
    call.resolve(resposta);
  }

  private static final String ACAO_PERMISSAO_USB = "com.rspratas.app.USB";

  /**
   * Imprime pelo cabo.
   *
   * A permissão de USB é pedida ao sistema uma vez por aparelho conectado. Ela
   * abre a única janela do Android em todo o fluxo, e quem monta o balcão pode
   * marcar "sempre permitir" para nunca mais vê-la.
   */
  @PluginMethod
  public void imprimirNoUsb(PluginCall call) {
    String endereco = call.getString("endereco");
    String conteudo = call.getString("conteudo");

    if (endereco == null || conteudo == null) {
      call.reject("FALTAM_DADOS");
      return;
    }

    UsbManager gerente = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    UsbDevice aparelho = gerente == null ? null : gerente.getDeviceList().get(endereco);

    if (aparelho == null) {
      call.reject("USB_AUSENTE");
      return;
    }

    if (gerente.hasPermission(aparelho)) {
      escreverNoUsb(call, gerente, aparelho, conteudo);
      return;
    }

    BroadcastReceiver resposta =
        new BroadcastReceiver() {
          @Override
          public void onReceive(Context contexto, Intent intent) {
            getContext().unregisterReceiver(this);

            if (!gerente.hasPermission(aparelho)) {
              call.reject("USB_SEM_PERMISSAO");
              return;
            }

            escreverNoUsb(call, gerente, aparelho, conteudo);
          }
        };

    IntentFilter filtro = new IntentFilter(ACAO_PERMISSAO_USB);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      getContext().registerReceiver(resposta, filtro, Context.RECEIVER_NOT_EXPORTED);
    } else {
      getContext().registerReceiver(resposta, filtro);
    }

    gerente.requestPermission(
        aparelho,
        PendingIntent.getBroadcast(
            getContext(),
            0,
            new Intent(ACAO_PERMISSAO_USB).setPackage(getContext().getPackageName()),
            PendingIntent.FLAG_IMMUTABLE));
  }

  private void escreverNoUsb(
      PluginCall call, UsbManager gerente, UsbDevice aparelho, String conteudo) {
    new Thread(
            () -> {
              UsbInterface face = interfaceDeImpressora(aparelho);

              if (face == null) {
                call.reject("USB_NAO_E_IMPRESSORA");
                return;
              }

              UsbDeviceConnection conexao = null;

              try {
                UsbEndpoint saida = null;
                for (int i = 0; i < face.getEndpointCount(); i += 1) {
                  UsbEndpoint canal = face.getEndpoint(i);
                  if (canal.getDirection() == UsbConstants.USB_DIR_OUT) {
                    saida = canal;
                    break;
                  }
                }

                if (saida == null) {
                  call.reject("USB_SEM_CANAL");
                  return;
                }

                conexao = gerente.openDevice(aparelho);
                conexao.claimInterface(face, true);

                byte[] bytes = Base64.decode(conteudo, Base64.DEFAULT);

                // Mesma divisão em blocos do Bluetooth, pelo mesmo motivo: o
                // buffer da impressora é pequeno.
                int inicio = 0;
                while (inicio < bytes.length) {
                  int tamanho = Math.min(256, bytes.length - inicio);
                  byte[] parte = new byte[tamanho];
                  System.arraycopy(bytes, inicio, parte, 0, tamanho);

                  if (conexao.bulkTransfer(saida, parte, tamanho, 3000) < 0) {
                    call.reject("USB_FALHOU");
                    return;
                  }

                  inicio += tamanho;
                }

                Thread.sleep(400);

                JSObject resposta = new JSObject();
                resposta.put("impresso", true);
                call.resolve(resposta);
              } catch (Exception erro) {
                call.reject("USB_FALHOU: " + erro.getMessage());
              } finally {
                if (conexao != null) {
                  conexao.releaseInterface(face);
                  conexao.close();
                }
              }
            },
            "impressao-usb")
        .start();
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

                // O mesmo despejo dos outros dois caminhos: a divisão em
                // blocos e a pausa final valem para qualquer porta, porque o
                // limite é da impressora, não da conexão.
                despejar(socket.getOutputStream(), Base64.decode(conteudo, Base64.DEFAULT));

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
