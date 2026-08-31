import { useEffect, useState } from "react";
import { Bluetooth, Cable, Network, RefreshCw, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { montarEtiquetasTspl } from "@/lib/tspl";
import {
  explicarFalha,
  guardarImpressoraDeEtiqueta,
  imprimirBytesNaEtiqueta,
  lerImpressoraDeEtiqueta,
  listarImpressoras,
  listarImpressorasUsb,
  temImpressora,
  type Ligacao,
  type ImpressoraEscolhida,
} from "./printer";

/**
 * Escolher a impressora de ETIQUETA deste aparelho.
 *
 * É outra máquina, e por isso outra escolha. A de comprovante fala ESC/POS em
 * bobina contínua; a de etiqueta fala TSPL em papel picotado, e precisa saber
 * onde cada recorte começa. Guardar as duas juntas faria escolher uma
 * desconfigurar a outra, e o erro só apareceria na hora de imprimir.
 *
 * Com uma escolhida aqui, o sistema manda a etiqueta DIRETO para ela e o
 * diálogo de impressão do navegador deixa de participar. É o que resolve, de
 * uma vez, a origem de quase todo problema de etiqueta: o navegador escolhendo
 * o papel, aplicando margem, escalando o desenho e criando páginas por conta
 * própria — cada página a mais sendo uma etiqueta desperdiçada.
 *
 * Sem nada escolhido, a impressão continua pelo navegador, que é como o
 * computador do escritório imprime.
 */

const LIGACOES: { valor: Ligacao; rotulo: string; icone: typeof Tag }[] = [
  { valor: "BLUETOOTH", rotulo: "Bluetooth", icone: Bluetooth },
  { valor: "REDE", rotulo: "Rede", icone: Network },
  { valor: "USB", rotulo: "Cabo USB", icone: Cable },
];

/** O rolo usado no teste: o de três colunas que já está na impressora. */
const ROLO_DE_TESTE = {
  larguraMm: 33,
  alturaMm: 21,
  colunas: 3,
  folgaXMm: 1.2,
  intervaloYMm: 3.1,
  bobinaMm: 104,
  dupla: false,
};

export function LabelPrinterSettings() {
  const [ligacao, setLigacao] = useState<Ligacao>("BLUETOOTH");
  const [encontradas, setEncontradas] = useState<ImpressoraEscolhida[]>([]);
  const [escolhida, setEscolhida] = useState<ImpressoraEscolhida | null>(null);
  const [ip, setIp] = useState("");

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    void (async () => {
      const guardada = await lerImpressoraDeEtiqueta();
      setEscolhida(guardada);
      if (guardada) {
        setLigacao(guardada.ligacao);
        if (guardada.ligacao === "REDE") setIp(guardada.endereco);
      }
    })();
  }, []);

  async function procurar() {
    setErro(null);
    setAviso(null);
    setProcurando(true);

    try {
      setEncontradas(ligacao === "USB" ? await listarImpressorasUsb() : await listarImpressoras());
    } catch (falha) {
      setErro(explicarFalha(falha));
    } finally {
      setProcurando(false);
    }
  }

  async function usar(impressora: ImpressoraEscolhida) {
    // `colunas` é da impressora de comprovante e não significa nada aqui: a
    // etiqueta é medida em milímetros, não em colunas de texto.
    const paraGuardar = { ...impressora, colunas: 0 };

    await guardarImpressoraDeEtiqueta(paraGuardar);
    setEscolhida(paraGuardar);
    setAviso(`Etiquetas vão sair na ${impressora.nome}.`);
  }

  async function usarRede() {
    const endereco = ip.trim();
    if (!endereco) {
      setErro("Digite o endereço IP que aparece no autoteste da impressora.");
      return;
    }

    await usar({
      nome: `Etiqueta em ${endereco}`,
      endereco,
      ligacao: "REDE",
      porta: 9100,
      colunas: 0,
    });
  }

  async function testar() {
    setErro(null);
    setAviso(null);
    setTestando(true);

    try {
      await imprimirBytesNaEtiqueta(
        montarEtiquetasTspl(
          [1, 2, 3].map((n) => ({
            nome: "RS PRATAS",
            sku: `TESTE-${n}`,
            preco: "0,00",
            tamanho: null,
            codigoDeBarras: `TESTE${n}`,
          })),
          ROLO_DE_TESTE,
        ),
      );
      setAviso("Saiu uma linha de teste com três etiquetas. Confira o alinhamento no papel.");
    } catch (falha) {
      setErro(explicarFalha(falha));
    } finally {
      setTestando(false);
    }
  }

  if (!temImpressora()) return null;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="flex items-center gap-2 font-semibold text-text-primary">
        <Tag className="h-5 w-5" aria-hidden />
        Impressora de etiqueta
      </h2>

      <p className="mt-1 text-sm text-text-secondary">
        Escolhendo uma aqui, a etiqueta vai direto para ela, com a medida exata em milímetros.
        Sem nenhuma escolhida, a impressão continua pelo diálogo do navegador.
      </p>

      {escolhida && (
        <div className="mt-3">
          <Alert tone="success">
            Usando <strong>{escolhida.nome}</strong> por {escolhida.ligacao.toLowerCase()}.
          </Alert>
        </div>
      )}

      {erro && (
        <div className="mt-3">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}
      {aviso && (
        <div className="mt-3">
          <Alert tone="info">{aviso}</Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {LIGACOES.map((opcao) => {
          const Icone = opcao.icone;
          const ativa = ligacao === opcao.valor;

          return (
            <Button
              key={opcao.valor}
              type="button"
              variant={ativa ? "primary" : "outline"}
              aria-pressed={ativa}
              onClick={() => {
                setLigacao(opcao.valor);
                setEncontradas([]);
              }}
            >
              <Icone className="h-4 w-4" aria-hidden />
              {opcao.rotulo}
            </Button>
          );
        })}
      </div>

      {ligacao === "REDE" ? (
        <div className="mt-4 max-w-sm">
          <Field
            label="Endereço IP da impressora"
            value={ip}
            onChange={(evento) => setIp(evento.target.value)}
            hint="O número que aparece no autoteste dela. A porta 9100 é o padrão."
          />
          <Button type="button" className="mt-3" onClick={() => void usarRede()}>
            Usar esta
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <Button type="button" variant="outline" disabled={procurando} onClick={() => void procurar()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            {procurando ? "Procurando…" : "Procurar impressoras"}
          </Button>

          {encontradas.length > 0 && (
            <ul className="mt-3 space-y-2">
              {encontradas.map((impressora) => (
                <li
                  key={impressora.endereco}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <span className="min-w-0 text-sm">
                    <span className="block truncate font-medium text-text-primary">
                      {impressora.nome}
                    </span>
                    <span className="block truncate text-text-secondary">
                      {impressora.endereco}
                    </span>
                  </span>
                  <Button type="button" variant="outline" onClick={() => void usar(impressora)}>
                    Usar
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {!procurando && encontradas.length === 0 && ligacao === "BLUETOOTH" && (
            <p className="mt-3 text-sm text-text-secondary">
              A impressora precisa estar <strong>pareada</strong> no Bluetooth do aparelho antes de
              aparecer aqui. Na L42 o nome é <strong>L42PF</strong> e o código é{" "}
              <strong>1234</strong>.
            </p>
          )}
        </div>
      )}

      {escolhida && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" disabled={testando} onClick={() => void testar()}>
            {testando ? "Imprimindo…" : "Imprimir teste"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await guardarImpressoraDeEtiqueta(null);
              setEscolhida(null);
              setAviso("Voltou a imprimir pelo navegador.");
            }}
          >
            Parar de usar
          </Button>
        </div>
      )}
    </section>
  );
}
