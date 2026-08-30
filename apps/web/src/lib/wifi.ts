import { registerPlugin } from "@capacitor/core";
import { Capacitor } from "@capacitor/core";

/**
 * Abrir a tela de Wi-Fi do aparelho, de dentro do sistema.
 *
 * Existe por causa de um círculo que só aparece quando a internet cai: sair do
 * modo quiosque exige autorização do servidor, e o servidor só responde se
 * houver internet. Um tablet que perdeu o Wi-Fi — a loja trocou a senha, o
 * roteador foi substituído, o aparelho mudou de endereço — não tinha como
 * voltar a se conectar por dentro do sistema. Ficava mudo, e o caminho era
 * desinstalar ou provisionar de novo.
 *
 * Conectar-se a uma rede não é ação sensível: não mexe em venda, em dinheiro
 * nem em cadastro. O que se ganha destrancando é um tablet que volta a
 * funcionar; o que se perderia trancando é a loja parada.
 */

interface KioskPlugin {
  abrirWifi(): Promise<{ abriu: boolean }>;
}

const Kiosk = registerPlugin<KioskPlugin>("Kiosk");

/**
 * Só faz sentido dentro do aplicativo.
 *
 * No navegador do computador não há quiosque para interromper nem tela do
 * Android para abrir — quem está ali resolve o Wi-Fi pelo próprio sistema.
 */
export function podeAbrirWifi(): boolean {
  return Capacitor.isNativePlatform();
}

export async function abrirWifi(): Promise<boolean> {
  if (!podeAbrirWifi()) return false;

  try {
    const { abriu } = await Kiosk.abrirWifi();
    return abriu;
  } catch {
    return false;
  }
}
