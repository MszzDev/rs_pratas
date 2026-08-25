import { useEffect, useRef } from "react";

/**
 * Leitor de código de barras.
 *
 * Praticamente todo leitor de balcão — USB ou Bluetooth — se apresenta ao
 * sistema como TECLADO. Ele "digita" o código e termina com Enter. Não há
 * driver, não há permissão de câmera, não há nada a instalar: por isso este
 * gancho ouve o teclado em vez de abrir a câmera.
 *
 * O que separa o leitor de uma pessoa digitando é a VELOCIDADE. Um leitor
 * despeja o código inteiro em poucos milissegundos por caractere; ninguém
 * digita "AN-1002-16" em 300 ms. É essa diferença que o gancho usa para não
 * disparar quando a vendedora está apenas procurando "anel" pelo nome.
 */

/** Acima deste intervalo entre teclas, é gente digitando. */
const INTERVALO_MAXIMO_MS = 35;

/** Códigos mais curtos que isto são digitação, não leitura. */
const TAMANHO_MINIMO = 4;

export function useBarcodeScanner(aoLer: (codigo: string) => void) {
  const buffer = useRef("");
  const ultimaTecla = useRef(0);

  // Guarda a função numa referência para o efeito não reinstalar o ouvinte a
  // cada render — sem isso, um `onScan` recriado desligaria e religaria o
  // listener no meio de uma leitura, perdendo os caracteres do meio.
  const callback = useRef(aoLer);
  callback.current = aoLer;

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      const agora = Date.now();
      const intervalo = agora - ultimaTecla.current;
      ultimaTecla.current = agora;

      if (evento.key === "Enter") {
        const codigo = buffer.current;
        buffer.current = "";

        if (codigo.length >= TAMANHO_MINIMO) {
          // Impede o Enter de enviar o formulário em que o foco estiver.
          evento.preventDefault();
          callback.current(codigo);
        }
        return;
      }

      // Pausa longa: o que veio antes era outra coisa. Recomeça.
      if (intervalo > INTERVALO_MAXIMO_MS) {
        buffer.current = "";
      }

      // Só caracteres únicos: ignora Shift, Tab, setas e afins.
      if (evento.key.length === 1) {
        buffer.current += evento.key;
      }
    };

    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);
}
