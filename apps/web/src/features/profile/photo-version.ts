import { useSyncExternalStore } from "react";

/**
 * Avisa a tela inteira quando a foto de alguém mudou.
 *
 * A foto é buscada por um endereço fixo (`/users/{id}/photo`). Quem já a tem
 * na tela não descobre sozinho que ela trocou ou sumiu: o endereço continua o
 * mesmo, então não há o que refazer.
 *
 * Foi o defeito: apagar a foto sumia com ela no perfil — que refazia a busca
 * por conta própria — e o retrato no canto da barra lateral continuava lá,
 * mostrando uma foto que já não existe.
 *
 * Este contador é o aviso. Ele entra no endereço como `?v=`, então mudá-lo faz
 * cada retrato aberto buscar de novo. Um contador só para todo mundo, e não um
 * por pessoa: foto muda uma vez a cada muitos meses, e refazer dois ou três
 * pedidos de imagem quando isso acontece custa menos que a contabilidade de
 * saber exatamente de quem era.
 */

let versao = 0;
const ouvintes = new Set<() => void>();

export function fotoMudou(): void {
  versao += 1;
  for (const avisar of ouvintes) avisar();
}

export function useVersaoDaFoto(): number {
  return useSyncExternalStore(
    (avisar) => {
      ouvintes.add(avisar);
      return () => ouvintes.delete(avisar);
    },
    () => versao,
    () => versao,
  );
}
