import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Maximize2,
  Minus,
  Plus,
  Ruler,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  desenhoDeEnvio,
  desenhoPadrao,
  type CampoDaEtiqueta,
  type LabelElement,
} from "@rs-pratas/shared";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";
import { EtiquetaDesenhada, type DadosDaEtiqueta } from "./LabelDrawing";

/**
 * O editor de etiquetas.
 *
 * O dono arrasta cada coisa para onde quer e vê a etiqueta do tamanho que ela
 * vai sair. Antes disso o formato era fixo — nome em cima, barras no meio,
 * preço embaixo — e o que se podia mudar eram interruptores de "mostra ou não
 * mostra". Isso resolve a etiqueta comum e não resolve nenhuma outra.
 *
 * Três decisões que sustentam o resto:
 *
 * 1. **Milímetro em tudo.** Posição, tamanho e letra são medidos na mesma
 *    unidade da impressora. Pixel dependeria do monitor e sairia diferente em
 *    cada aparelho.
 *
 * 2. **O mesmo componente da impressão.** O que aparece aqui é o
 *    `EtiquetaDesenhada` que vai para o papel — não uma imitação dele. Duas
 *    implementações divergiriam na primeira mudança, e a promessa do editor é
 *    justamente que o que se vê é o que sai.
 *
 * 3. **A régua fica de lado.** Na impressão o navegador usa milímetro de
 *    verdade; na tela ele usa a ideia que tem de milímetro, que erra conforme
 *    o monitor. Dizer "escala real" sem conferir seria uma promessa que a tela
 *    não cumpre — mas pedir a régua ANTES de deixar a pessoa desenhar inverte
 *    a ordem do trabalho. O padrão é caber na tela, que é o que se quer para
 *    arrastar; o tamanho real é um botão, e acertar a régua é um link para
 *    quem reparar que não confere.
 */

/**
 * Quanto vale um milímetro de CSS.
 *
 * O navegador trata `1mm` como 96/25.4 pixels, sempre — é uma constante da
 * especificação, não uma medida do monitor. O desenho é escrito em milímetros
 * porque é assim que ele vai para o papel, então ampliar na tela é dividir o
 * zoom desejado por essa constante. Aplicar o zoom direto multiplicaria duas
 * vezes, e a etiqueta saía quase quatro vezes maior que o pedido.
 */
const PX_POR_MM_CSS = 96 / 25.4;

interface Modelo {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  isDoubleSided: boolean;
  elements: LabelElement[] | null;
}

/**
 * Uma peça e um pacote de mentira, para o desenho ter o que mostrar.
 *
 * O exemplo do envio traz um endereço de verdade em forma — rua com número,
 * complemento na própria linha, CEP com hífen. Um exemplo curto demais faria o
 * dono desenhar um espaço que o endereço real não cabe, e ele só descobriria
 * isso com o primeiro pacote na mão.
 */
const EXEMPLO: DadosDaEtiqueta = {
  productName: "Anel Solitário Zircônia",
  sku: "RS-001",
  price: "189.90",
  size: "18",
  weightGrams: "2.400",
  barcode: "RS-001",
  envio: {
    destinatario: "Mariana Ferreira de Almeida",
    endereco: "Rua das Palmeiras, 1042\napto 71, bloco B",
    bairro: "Jardim Paulista",
    cidadeUf: "São Paulo - SP",
    cep: "01415002",
    remetente: "Remetente: RS Pratas Centro\nAv. São João, 300\n01035-000 Centro - São Paulo - SP\n(11) 3333-0000",
    pedido: "1288",
  },
};

const CAMPOS: { valor: CampoDaEtiqueta; rotulo: string }[] = [
  { valor: "NOME", rotulo: "Nome da peça" },
  { valor: "SKU", rotulo: "Código" },
  { valor: "PRECO", rotulo: "Preço" },
  { valor: "TAMANHO", rotulo: "Tamanho" },
  { valor: "PESO", rotulo: "Peso" },
  { valor: "CODIGO_BARRAS", rotulo: "Código de barras" },
  { valor: "TEXTO", rotulo: "Texto livre" },
];

/** Os campos do pacote, separados porque respondem outra pergunta. */
const CAMPOS_DE_ENVIO: { valor: CampoDaEtiqueta; rotulo: string }[] = [
  { valor: "DESTINATARIO", rotulo: "Destinatário" },
  { valor: "ENDERECO_ENTREGA", rotulo: "Endereço" },
  { valor: "BAIRRO", rotulo: "Bairro" },
  { valor: "CIDADE_UF", rotulo: "Cidade / UF" },
  { valor: "CEP", rotulo: "CEP" },
  { valor: "REMETENTE", rotulo: "Remetente" },
  { valor: "PEDIDO", rotulo: "Nº do pedido" },
];

/**
 * Quanto um milímetro mede na tela DESTE aparelho.
 *
 * Guardado no navegador porque é do monitor, não da empresa: o desenho é o
 * mesmo para todo mundo, e só o zoom com que ele aparece muda.
 */
const CHAVE_REGUA = "rs.reguaMm";

function lerRegua(): number {
  const guardado = Number(localStorage.getItem(CHAVE_REGUA));
  return Number.isFinite(guardado) && guardado > 0.2 && guardado < 5 ? guardado : 1;
}

export function LabelEditor({ modelo, onClose }: { modelo: Modelo; onClose: () => void }) {
  const queryClient = useQueryClient();
  const area = useRef<HTMLDivElement>(null);

  const [elementos, setElementos] = useState<LabelElement[]>(
    modelo.elements && modelo.elements.length > 0
      ? modelo.elements
      : desenhoPadrao(modelo.widthMm, modelo.heightMm),
  );
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  /**
   * Quantos pixels de tela vale um milímetro da etiqueta.
   *
   * Começa em zero e é calculado quando a área aparece: o padrão é a etiqueta
   * CABER, que é o que se quer para arrastar. Chutar um zoom fixo daria uma
   * etiqueta de 100 mm estourando a tela e uma de 12 mm do tamanho de uma
   * unha — e as duas existem no mesmo sistema.
   */
  const [pixelPorMm, setPixelPorMm] = useState(0);
  const [ajusteDaTela, setAjusteDaTela] = useState(1);
  const [medindo, setMedindo] = useState(false);
  const [medida, setMedida] = useState("");

  useEffect(() => {
    setAjusteDaTela(lerRegua());
  }, []);

  /**
   * Faz a etiqueta caber na largura disponível.
   *
   * O respiro de 32 px é a borda e o preenchimento da moldura; sem ele a
   * etiqueta encostaria na linha. O teto de 12 px por milímetro impede que uma
   * etiqueta pequena vire um cartaz numa tela larga.
   */
  const caberNaTela = useCallback(() => {
    const largura = area.current?.clientWidth ?? 0;
    if (largura <= 0) return;

    setPixelPorMm(Math.max(1, Math.min(12, (largura - 32) / modelo.widthMm)));
  }, [modelo.widthMm]);

  /**
   * Começa cabendo, e refaz quando o espaço muda — girar o tablet, abrir o
   * teclado, encolher a janela.
   *
   * Só reage à LARGURA. Observar a altura faria um laço: etiqueta mais alta
   * encolhe o zoom, o zoom menor encolhe a altura da área, e a conta recomeça.
   */
  useEffect(() => {
    const alvo = area.current;
    if (!alvo) return;

    caberNaTela();

    let ultimaLargura = alvo.clientWidth;

    const observador = new ResizeObserver((entradas) => {
      const largura = entradas[0]?.contentRect.width ?? 0;
      if (largura > 0 && Math.abs(largura - ultimaLargura) > 1) {
        ultimaLargura = largura;
        caberNaTela();
      }
    });

    observador.observe(alvo);
    return () => observador.disconnect();
  }, [caberNaTela]);

  const atual = elementos.find((e) => e.id === selecionado) ?? null;

  function alterar(id: string, mudanca: Partial<LabelElement>) {
    setSalvo(false);
    setElementos((antes) =>
      antes.map((e) => (e.id === id ? ({ ...e, ...mudanca } as LabelElement) : e)),
    );
  }

  function acrescentar(campo: CampoDaEtiqueta) {
    const novo: LabelElement = {
      id: `${campo.toLowerCase()}-${Date.now().toString(36)}`,
      campo,
      xMm: 1,
      yMm: 1,
      larguraMm: Math.max(6, modelo.widthMm - 2),
      tamanhoMm: campo === "PRECO" ? 2.6 : 2,
      negrito: campo === "PRECO" || campo === "NOME",
      alinhamento: "center",
      ...(campo === "CODIGO_BARRAS" ? { alturaMm: Math.max(4, modelo.heightMm * 0.3) } : {}),
      ...(campo === "TEXTO" ? { texto: "prata 925" } : {}),
    };

    setSalvo(false);
    setElementos((antes) => [...antes, novo]);
    setSelecionado(novo.id);
  }

  /**
   * Arrastar.
   *
   * Os eventos de ponteiro, e não os de mouse: no tablet o dono arrasta com o
   * dedo, e o mouse não existe lá. `setPointerCapture` mantém o elemento
   * seguindo o dedo mesmo quando ele sai da área da etiqueta — sem isso, um
   * arrasto rápido "solta" o elemento no meio do caminho.
   */
  function comecarArrasto(evento: React.PointerEvent, elemento: LabelElement) {
    evento.preventDefault();
    setSelecionado(elemento.id);

    const alvo = evento.currentTarget as HTMLElement;
    alvo.setPointerCapture(evento.pointerId);

    const inicioX = evento.clientX;
    const inicioY = evento.clientY;
    const origemX = elemento.xMm;
    const origemY = elemento.yMm;

    const mover = (e: PointerEvent) => {
      // Arredondado em décimos de milímetro: o dedo tem precisão de
      // milímetros, e guardar 0,03847 mm daria uma falsa sensação de exatidão.
      const x = origemX + (e.clientX - inicioX) / pixelPorMm;
      const y = origemY + (e.clientY - inicioY) / pixelPorMm;

      alterar(elemento.id, {
        xMm: Math.round(Math.max(-2, Math.min(modelo.widthMm, x)) * 10) / 10,
        yMm: Math.round(Math.max(-2, Math.min(modelo.heightMm, y)) * 10) / 10,
      });
    };

    const soltar = () => {
      alvo.releasePointerCapture(evento.pointerId);
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };

    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  const salvar = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/label-templates/${modelo.id}/elements`, {
        method: "PUT",
        body: { elements: elementos },
      }),
    onSuccess: () => {
      setErro(null);
      setSalvo(true);
      void queryClient.invalidateQueries({ queryKey: ["label-templates"] });
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível salvar o desenho."),
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-text-primary/80 p-3">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-lg bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-semibold text-text-primary">Desenho da etiqueta</h2>
            <p className="text-sm text-text-secondary">
              {modelo.name} · {modelo.widthMm} × {modelo.heightMm} mm
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={salvar.isPending} onClick={() => salvar.mutate()}>
              <Save className="h-5 w-5" aria-hidden />
              {salvar.isPending ? "Salvando..." : salvo ? "Salvo" : "Salvar desenho"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              <X className="h-5 w-5" aria-hidden />
              Fechar
            </Button>
          </div>
        </header>

        {erro && (
          <div className="border-b border-border p-4">
            <Alert tone="error">{erro}</Alert>
          </div>
        )}

        <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 lg:flex-row">
          {/* ------------------------------------------------------ a etiqueta */}
          <div className="flex-1" ref={area}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="diminuir"
                  onClick={() => setPixelPorMm((atual) => Math.max(1, atual / 1.25))}
                >
                  <Minus className="h-5 w-5" aria-hidden />
                </Button>

                <span
                  className="min-w-[4.5rem] text-center text-sm text-text-secondary"
                  aria-live="polite"
                >
                  {Math.round((pixelPorMm / (PX_POR_MM_CSS * ajusteDaTela)) * 100)}%
                </span>

                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="aumentar"
                  onClick={() => setPixelPorMm((atual) => Math.min(24, atual * 1.25))}
                >
                  <Plus className="h-5 w-5" aria-hidden />
                </Button>
              </div>

              <Button type="button" variant="ghost" onClick={caberNaTela}>
                <Maximize2 className="h-5 w-5" aria-hidden />
                Caber na tela
              </Button>

              {/*
                Cem por cento é a etiqueta do tamanho em que ela vai sair. Fica
                como botão, e não como padrão: numa etiqueta de 12 mm de altura
                o tamanho real é pequeno demais para arrastar com o dedo.
              */}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPixelPorMm(PX_POR_MM_CSS * ajusteDaTela)}
              >
                Tamanho real
              </Button>
            </div>

            {/*
              Duas camadas de propósito.

              A de fora tem o tamanho JÁ ampliado, em pixels, e é ela que ocupa
              espaço na página. A de dentro é escrita em milímetros — a mesma
              unidade do papel — e só recebe a lente do `scale`. Sem a de fora,
              o navegador reserva o espaço do tamanho ORIGINAL: a etiqueta
              ampliada vaza por cima do que vem depois, a caixa ganha barras de
              rolagem e mostra um pedaço da peça.
            */}
            <div
              className="rounded border border-border bg-white p-2"
              style={{ width: "fit-content", maxWidth: "100%" }}
            >
              <div
                style={{
                  position: "relative",
                  width: `${modelo.widthMm * pixelPorMm}px`,
                  height: `${modelo.heightMm * pixelPorMm}px`,
                }}
              >
                <div
                  onPointerDown={(evento) => {
                    if (evento.target === evento.currentTarget) setSelecionado(null);
                  }}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: `${modelo.widthMm}mm`,
                    height: `${modelo.heightMm}mm`,
                    transform: `scale(${pixelPorMm / PX_POR_MM_CSS})`,
                    transformOrigin: "top left",
                    outline: "1px dashed #999",
                    color: "#000",
                    background: "#fff",
                  }}
                >
                  <EtiquetaDesenhada
                    elementos={elementos}
                    dados={EXEMPLO}
                    larguraMm={modelo.widthMm}
                    alturaMm={modelo.heightMm}
                  />

                  {/* As alças de arrasto ficam por cima do desenho. */}
                  {elementos.map((elemento) => (
                    <div
                      key={elemento.id}
                      onPointerDown={(evento) => comecarArrasto(evento, elemento)}
                      style={{
                        position: "absolute",
                        left: `${elemento.xMm}mm`,
                        top: `${elemento.yMm}mm`,
                        width: `${elemento.larguraMm}mm`,
                        height: `${elemento.alturaMm ?? elemento.tamanhoMm * 1.2}mm`,
                        cursor: "move",
                        touchAction: "none",
                        outline:
                          selecionado === elemento.id
                            ? "0.3mm solid #9B4F53"
                            : "0.15mm dotted #bbb",
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/*
              A régua vive aqui embaixo, como link.

              Ela responde a uma pergunta que a pessoa só faz DEPOIS de reparar
              que a etiqueta na tela não bate com a da mão. Pedir a medição
              antes de deixar desenhar inverteria a ordem do trabalho.
            */}
            <button
              type="button"
              className="mt-3 text-sm text-text-secondary underline"
              onClick={() => setMedindo(!medindo)}
            >
              <Ruler className="mr-1 inline h-4 w-4" aria-hidden />
              Em tamanho real, a etiqueta na tela não bate com a de verdade?
            </button>

            {medindo && (
              <div className="mt-3 rounded-md border border-border bg-background-secondary p-4">
                <p className="text-sm text-text-secondary">
                  A tela não sabe o próprio tamanho. Encoste uma régua na barra abaixo e escreva
                  quantos milímetros ela tem de ponta a ponta — o desenho passa a aparecer no
                  tamanho certo neste aparelho.
                </p>

                <div
                  className="my-3 rounded bg-rose-primary"
                  style={{ width: `${50 * PX_POR_MM_CSS * ajusteDaTela}px`, height: "10px" }}
                  aria-hidden
                />

                <div className="flex flex-wrap items-end gap-3">
                  <Field
                    label="Quanto mediu (mm)"
                    type="number"
                    value={medida}
                    onChange={(evento) => setMedida(evento.target.value)}
                    placeholder="50"
                    className="max-w-[10rem]"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      const medido = Number(medida);
                      if (!Number.isFinite(medido) || medido <= 0) return;

                      // A barra foi desenhada com 50 mm segundo a conta atual.
                      // Se a régua diz outro número, a proporção entre os dois
                      // é o erro deste monitor.
                      const fator = (50 / medido) * ajusteDaTela;
                      setAjusteDaTela(fator);
                      localStorage.setItem(CHAVE_REGUA, String(fator));
                      setMedindo(false);
                      setMedida("");
                    }}
                  >
                    Acertar
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ----------------------------------------------------- as escolhas */}
          <aside className="w-full space-y-5 lg:w-80">
            <div>
              <h3 className="mb-2 text-sm font-medium text-text-secondary">Da peça</h3>
              <div className="flex flex-wrap gap-2">
                {CAMPOS.map((campo) => (
                  <Button
                    key={campo.valor}
                    type="button"
                    variant="outline"
                    onClick={() => acrescentar(campo.valor)}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    {campo.rotulo}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium text-text-secondary">Do pacote</h3>
              <div className="flex flex-wrap gap-2">
                {CAMPOS_DE_ENVIO.map((campo) => (
                  <Button
                    key={campo.valor}
                    type="button"
                    variant="outline"
                    onClick={() => acrescentar(campo.valor)}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    {campo.rotulo}
                  </Button>
                ))}
              </div>

              <p className="mt-2 text-sm text-text-muted">
                Só aparecem impressos quando a etiqueta vem de uma compra da loja virtual.
              </p>
            </div>

            {atual ? (
              <div className="space-y-4 rounded-md border border-border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-text-primary">
                    {CAMPOS.find((c) => c.valor === atual.campo)?.rotulo}
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSalvo(false);
                      setElementos((antes) => antes.filter((e) => e.id !== atual.id));
                      setSelecionado(null);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Tirar
                  </Button>
                </div>

                {atual.campo === "TEXTO" && (
                  <Field
                    label="O que escrever"
                    value={atual.texto ?? ""}
                    onChange={(evento) => alterar(atual.id, { texto: evento.target.value })}
                  />
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="Esquerda (mm)"
                    type="number"
                    step={0.5}
                    value={String(atual.xMm)}
                    onChange={(evento) => alterar(atual.id, { xMm: Number(evento.target.value) })}
                  />
                  <Field
                    label="Topo (mm)"
                    type="number"
                    step={0.5}
                    value={String(atual.yMm)}
                    onChange={(evento) => alterar(atual.id, { yMm: Number(evento.target.value) })}
                  />
                  <Field
                    label="Largura (mm)"
                    type="number"
                    step={0.5}
                    value={String(atual.larguraMm)}
                    onChange={(evento) =>
                      alterar(atual.id, { larguraMm: Number(evento.target.value) })
                    }
                  />
                  {atual.campo === "CODIGO_BARRAS" ? (
                    <Field
                      label="Altura (mm)"
                      type="number"
                      step={0.5}
                      value={String(atual.alturaMm ?? 6)}
                      onChange={(evento) =>
                        alterar(atual.id, { alturaMm: Number(evento.target.value) })
                      }
                    />
                  ) : (
                    <Field
                      label="Letra (mm)"
                      type="number"
                      step={0.1}
                      value={String(atual.tamanhoMm)}
                      onChange={(evento) =>
                        alterar(atual.id, { tamanhoMm: Number(evento.target.value) })
                      }
                    />
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={atual.negrito ? "primary" : "outline"}
                    aria-pressed={atual.negrito}
                    onClick={() => alterar(atual.id, { negrito: !atual.negrito })}
                  >
                    <Bold className="h-4 w-4" aria-hidden />
                    Negrito
                  </Button>

                  {(
                    [
                      { valor: "left", icone: AlignLeft },
                      { valor: "center", icone: AlignCenter },
                      { valor: "right", icone: AlignRight },
                    ] as const
                  ).map((opcao) => {
                    const Icone = opcao.icone;
                    return (
                      <Button
                        key={opcao.valor}
                        type="button"
                        variant={atual.alinhamento === opcao.valor ? "primary" : "outline"}
                        aria-pressed={atual.alinhamento === opcao.valor}
                        onClick={() => alterar(atual.id, { alinhamento: opcao.valor })}
                      >
                        <Icone className="h-4 w-4" aria-hidden />
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">
                Toque num elemento da etiqueta para mover ou mudar. Arraste para posicionar.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSalvo(false);
                  setElementos(desenhoPadrao(modelo.widthMm, modelo.heightMm));
                  setSelecionado(null);
                }}
              >
                Começar do modelo de peça
              </Button>

              {/*
                Um ponto de partida para o pacote, na ordem em que o carteiro
                lê: destinatário em destaque, endereço abaixo, CEP grande no
                rodapé — é ele que decide a triagem — e o remetente pequeno no
                topo, onde não compete com o destino.
              */}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSalvo(false);
                  setElementos(desenhoDeEnvio(modelo.widthMm, modelo.heightMm));
                  setSelecionado(null);
                }}
              >
                Começar do modelo de envio
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
