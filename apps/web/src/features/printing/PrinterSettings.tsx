import { useEffect, useState } from "react";
import { Cable, Network, Printer, RefreshCw, Bluetooth } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Comprovante } from "@/lib/escpos";
import {
  explicarFalha,
  guardarImpressora,
  imprimirBytes,
  lerImpressoraEscolhida,
  listarImpressoras,
  listarImpressorasUsb,
  situacaoDaImpressao,
  temImpressora,
  type Ligacao,
  type ImpressoraEscolhida,
} from "./printer";

/**
 * Escolher a impressora deste balcão.
 *
 * Aparece só no tablet: no computador do dono não há impressora térmica
 * ligada, e mostrar a seção vazia lá só levantaria a dúvida de se está
 * faltando algo.
 *
 * Três formas de ligar, e a diferença entre elas não é técnica — é de balcão:
 *
 * - REDE é a mais robusta. Uma impressora atende vários aparelhos, não depende
 *   de pareamento, e não some quando alguém desliga o Bluetooth sem querer.
 * - CABO é o mais simples quando há um tablet e uma impressora, lado a lado.
 * - BLUETOOTH é para quando não há tomada de rede nem cabo sobrando.
 */

const LIGACOES: { valor: Ligacao; rotulo: string; icone: typeof Printer }[] = [
  { valor: "REDE", rotulo: "Rede", icone: Network },
  { valor: "USB", rotulo: "Cabo USB", icone: Cable },
  { valor: "BLUETOOTH", rotulo: "Bluetooth", icone: Bluetooth },
];

/** As larguras de rolo que existem no balcão. */
const LARGURAS = [
  { colunas: 32, rotulo: "58 mm" },
  { colunas: 48, rotulo: "80 mm" },
];

export function PrinterSettings() {
  const [ligacao, setLigacao] = useState<Ligacao>("REDE");
  const [encontradas, setEncontradas] = useState<ImpressoraEscolhida[]>([]);
  const [escolhida, setEscolhida] = useState<ImpressoraEscolhida | null>(null);
  const [situacao, setSituacao] = useState<{ ligado: boolean; temBluetooth: boolean } | null>(null);

  const [ip, setIp] = useState("");
  const [colunas, setColunas] = useState(48);

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    if (!temImpressora()) return;

    void situacaoDaImpressao().then(setSituacao);
    void lerImpressoraEscolhida().then((atual) => {
      setEscolhida(atual);
      if (atual) {
        setLigacao(atual.ligacao);
        setColunas(atual.colunas);
        if (atual.ligacao === "REDE") setIp(atual.endereco);
      }
    });
  }, []);

  if (!temImpressora()) return null;

  async function procurar() {
    setProcurando(true);
    setErro(null);

    try {
      setEncontradas(ligacao === "USB" ? await listarImpressorasUsb() : await listarImpressoras());
      setSituacao(await situacaoDaImpressao());
    } catch (caught) {
      setErro(explicarFalha(caught));
    } finally {
      setProcurando(false);
    }
  }

  async function escolher(impressora: ImpressoraEscolhida) {
    const comLargura = { ...impressora, colunas };
    await guardarImpressora(comLargura);
    setEscolhida(comLargura);
    setAviso(`Os comprovantes deste tablet vão sair na ${impressora.nome}.`);
    setErro(null);
  }

  /**
   * A impressora de rede não é "encontrada": ela é informada.
   *
   * Varrer a rede procurando quem responde na porta 9100 demoraria e acharia
   * também a impressora da loja ao lado, se as redes se enxergarem. O endereço
   * sai do autoteste da própria impressora — segurar o botão de avanço ao
   * ligar imprime uma folha com o IP.
   */
  async function usarRede() {
    const endereco = ip.trim();

    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(endereco)) {
      setErro("Escreva o endereço no formato 192.168.0.50, como aparece no autoteste da impressora.");
      return;
    }

    await escolher({
      nome: `Impressora em ${endereco}`,
      endereco,
      ligacao: "REDE",
      colunas,
    });
  }

  /**
   * A prova de que funciona.
   *
   * Escolher a impressora numa lista não prova nada: o nome pode estar certo e
   * o aparelho desligado, sem papel, ou ser a impressora da loja ao lado. Uma
   * tirinha de papel na mão resolve a dúvida antes do primeiro cliente.
   */
  async function testar() {
    setTestando(true);
    setErro(null);

    try {
      const papel = new Comprovante(escolhida?.colunas ?? colunas);
      papel.alinhamento(1).grande(true).negrito(true).linha("RS Pratas");
      papel.grande(false).negrito(false).linha("Teste de impressão").linha();
      papel.alinhamento(0).separador();
      papel.linha(`Impressora: ${escolhida?.nome ?? ""}`);
      papel.linha(`Ligação: ${escolhida?.ligacao ?? ""}`);
      papel.linha(new Date().toLocaleString("pt-BR"));
      papel.separador();
      papel.paragrafo("Acentuação: coração, açaí, ANÉIS, pingente, mão.");
      // A régua mostra, sem explicação, se a largura escolhida bate com o rolo:
      // se ela quebrar em duas linhas, o rolo é mais estreito do que se disse.
      papel.linha("1234567890".repeat(5).slice(0, escolhida?.colunas ?? colunas));
      papel.linha();
      papel.alinhamento(1).paragrafo("Se você está lendo isto, está tudo certo.");

      await imprimirBytes(papel.corta().paraBase64());
      setAviso("Saiu papel? Então este balcão está pronto.");
    } catch (caught) {
      setErro(explicarFalha(caught));
    } finally {
      setTestando(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="flex items-center gap-2 font-semibold text-text-primary">
        <Printer className="h-5 w-5 text-gold-dark" aria-hidden />
        Impressora deste balcão
      </h2>

      <p className="mt-1 text-sm text-text-secondary">
        {escolhida
          ? `Os comprovantes saem na ${escolhida.nome}, sozinhos, assim que a venda fecha.`
          : "Nenhuma impressora escolhida — os comprovantes só vão por e-mail."}
      </p>

      {/* ------------------------------------------------------- como ligar */}
      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-text-secondary">Como ela está ligada</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {LIGACOES.map((opcao) => {
            const Icone = opcao.icone;
            const ativo = ligacao === opcao.valor;

            return (
              <Button
                key={opcao.valor}
                type="button"
                variant={ativo ? "primary" : "outline"}
                aria-pressed={ativo}
                onClick={() => {
                  setLigacao(opcao.valor);
                  setEncontradas([]);
                  setErro(null);
                }}
              >
                <Icone className="h-5 w-5" aria-hidden />
                {opcao.rotulo}
              </Button>
            );
          })}
        </div>
      </fieldset>

      {/* --------------------------------------------------- largura do rolo */}
      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-text-secondary">Largura do papel</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {LARGURAS.map((opcao) => (
            <Button
              key={opcao.colunas}
              type="button"
              variant={colunas === opcao.colunas ? "primary" : "outline"}
              aria-pressed={colunas === opcao.colunas}
              onClick={() => setColunas(opcao.colunas)}
            >
              {opcao.rotulo}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-sm text-text-muted">
          A Elgin L42 usa o rolo de 80 mm. Errar aqui faz o comprovante sair quebrando no meio das
          palavras ou usando metade do papel.
        </p>
      </fieldset>

      {situacao && ligacao === "BLUETOOTH" && !situacao.temBluetooth && (
        <div className="mt-4">
          <Alert tone="info">Este tablet não tem Bluetooth. Use rede ou cabo.</Alert>
        </div>
      )}

      {situacao?.temBluetooth && ligacao === "BLUETOOTH" && !situacao.ligado && (
        <div className="mt-4">
          <Alert tone="info">
            O Bluetooth do tablet está desligado. Ligue nas configurações do aparelho para a
            impressora aparecer.
          </Alert>
        </div>
      )}

      {erro && (
        <div className="mt-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}

      {aviso && (
        <div className="mt-4">
          <Alert tone="success">{aviso}</Alert>
        </div>
      )}

      {/* ------------------------------------------------------------ rede */}
      {ligacao === "REDE" ? (
        <div className="mt-5 max-w-sm">
          <Field
            label="Endereço da impressora"
            value={ip}
            onChange={(event) => setIp(event.target.value)}
            placeholder="192.168.0.50"
            inputMode="decimal"
            hint="Está no autoteste: segure o botão de avanço de papel ao ligar a impressora e ela imprime uma folha com o endereço."
          />

          <Button type="button" className="mt-3" onClick={() => void usarRede()}>
            Usar esta impressora
          </Button>
        </div>
      ) : (
        <>
          {encontradas.length > 0 && (
            <ul className="mt-5 space-y-2">
              {encontradas.map((impressora) => {
                const atual = impressora.endereco === escolhida?.endereco;

                return (
                  <li
                    key={impressora.endereco}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4"
                  >
                    <div>
                      <p className="font-medium text-text-primary">{impressora.nome}</p>
                      <p className="text-sm text-text-muted">{impressora.endereco}</p>
                    </div>

                    <Button
                      type="button"
                      variant={atual ? "ghost" : "outline"}
                      disabled={atual}
                      onClick={() => void escolher(impressora)}
                    >
                      {atual ? "Em uso" : "Usar esta"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-5">
            <Button type="button" variant="outline" disabled={procurando} onClick={() => void procurar()}>
              <RefreshCw className="h-5 w-5" aria-hidden />
              {procurando ? "Procurando..." : "Procurar impressoras"}
            </Button>
          </div>
        </>
      )}

      {escolhida && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-5">
          <Button type="button" disabled={testando} onClick={() => void testar()}>
            {testando ? "Imprimindo..." : "Imprimir teste"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              await guardarImpressora(null);
              setEscolhida(null);
              setAviso("Impressora desligada deste tablet.");
            }}
          >
            Parar de usar
          </Button>
        </div>
      )}

      <p className="mt-4 border-t border-border pt-4 text-sm text-text-muted">
        {ligacao === "BLUETOOTH"
          ? "A impressora precisa estar pareada nas configurações de Bluetooth do tablet. Isso é feito uma vez, quando o balcão é montado."
          : ligacao === "USB"
            ? "Ligue o cabo antes de procurar. Na primeira impressão o Android pergunta se pode usar a impressora — marque 'sempre permitir' e ele não pergunta de novo."
            : "A impressora e o tablet precisam estar na mesma rede. Se a loja tiver duas — uma para clientes e outra para o caixa —, use a do caixa."}
      </p>
    </section>
  );
}
