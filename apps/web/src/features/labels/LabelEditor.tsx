import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Plus,
  Ruler,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
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
 * 3. **A régua.** Na impressão o navegador usa milímetro de verdade; na tela
 *    ele usa a ideia que tem de milímetro, que erra conforme o monitor. Dizer
 *    "escala real" sem conferir seria uma promessa que a tela não cumpre — a
 *    régua deixa o dono medir com uma régua de verdade e acertar.
 */

interface Modelo {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  isDoubleSided: boolean;
  elements: LabelElement[] | null;
}

/** Uma peça de mentira, para o desenho ter o que mostrar. */
const EXEMPLO: DadosDaEtiqueta = {
  productName: "Anel Solitário Zircônia",
  sku: "RS-001",
  price: "189.90",
  size: "18",
  weightGrams: "2.400",
  barcode: "RS-001",
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

  const [escala, setEscala] = useState(4);
  const [ajusteDaTela, setAjusteDaTela] = useState(1);
  const [medindo, setMedindo] = useState(false);
  const [medida, setMedida] = useState("");

  useEffect(() => {
    setAjusteDaTela(lerRegua());
  }, []);

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

    const pixelPorMm = escala * ajusteDaTela;
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

  const pixelPorMm = escala * ajusteDaTela;

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
          <div className="flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                Zoom
                <input
                  type="range"
                  min={2}
                  max={12}
                  step={0.5}
                  value={escala}
                  onChange={(evento) => setEscala(Number(evento.target.value))}
                />
              </label>

              <Button type="button" variant="ghost" onClick={() => setMedindo(!medindo)}>
                <Ruler className="h-5 w-5" aria-hidden />
                Ajustar ao tamanho real
              </Button>
            </div>

            {medindo && (
              <div className="mb-4 rounded-md border border-border bg-background-secondary p-4">
                <p className="text-sm text-text-secondary">
                  A tela não sabe o tamanho dela mesma. Meça a barra abaixo com uma régua de verdade
                  e escreva quantos milímetros ela tem — a partir daí o desenho aparece no tamanho
                  em que vai sair.
                </p>

                <div
                  className="my-3 rounded bg-rose-primary"
                  style={{ width: `${50 * pixelPorMm}px`, height: "10px" }}
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

                      // A barra foi desenhada com 50 mm. Se a régua diz outro
                      // número, a proporção entre os dois é o erro da tela.
                      const fator = (50 / medido) * ajusteDaTela;
                      setAjusteDaTela(fator);
                      localStorage.setItem(CHAVE_REGUA, String(fator));
                      setMedindo(false);
                    }}
                  >
                    Ajustar
                  </Button>
                </div>
              </div>
            )}

            {/*
              A etiqueta em si. O `transform: scale` amplia sem mexer nas
              medidas: o desenho continua em milímetros, e o zoom é só uma
              lente. Escalar as medidas em vez da visualização faria o dono
              salvar um desenho do tamanho do zoom.
            */}
            <div
              className="inline-block rounded border border-border bg-white p-4"
              style={{ overflow: "auto" }}
            >
              <div
                ref={area}
                onPointerDown={(evento) => {
                  if (evento.target === evento.currentTarget) setSelecionado(null);
                }}
                style={{
                  position: "relative",
                  width: `${modelo.widthMm}mm`,
                  height: `${modelo.heightMm}mm`,
                  transform: `scale(${pixelPorMm})`,
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
                        selecionado === elemento.id ? "0.3mm solid #9B4F53" : "0.15mm dotted #bbb",
                    }}
                  />
                ))}
              </div>
            </div>

            {/*
              O espaço que o `scale` ocupa não é contado pelo navegador — sem
              este vão, a lista de baixo subiria por cima da etiqueta ampliada.
            */}
            <div style={{ height: `${modelo.heightMm * pixelPorMm * 0.28}px` }} aria-hidden />
          </div>

          {/* ----------------------------------------------------- as escolhas */}
          <aside className="w-full space-y-5 lg:w-80">
            <div>
              <h3 className="mb-2 text-sm font-medium text-text-secondary">Acrescentar</h3>
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

            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSalvo(false);
                setElementos(desenhoPadrao(modelo.widthMm, modelo.heightMm));
                setSelecionado(null);
              }}
            >
              Voltar ao desenho padrão
            </Button>
          </aside>
        </div>
      </div>
    </div>
  );
}
