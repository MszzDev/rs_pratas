import { useEffect, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Comprovante } from "@/lib/escpos";
import {
  explicarFalha,
  guardarImpressora,
  imprimirBytes,
  lerImpressoraEscolhida,
  listarImpressoras,
  situacaoDaImpressao,
  temImpressora,
  type ImpressoraEscolhida,
} from "./printer";

/**
 * Escolher a impressora deste balcão.
 *
 * Aparece só no tablet: no computador do dono não há impressora térmica
 * pareada, e mostrar a seção vazia lá só levantaria a dúvida de se está
 * faltando algo.
 *
 * O pareamento do Bluetooth continua sendo feito nas configurações do Android,
 * uma vez por aparelho, por quem instala. Aqui se escolhe entre o que já está
 * pareado — pedir PIN de Bluetooth à vendedora seria transformar um ajuste de
 * instalação em tarefa de expediente.
 */
export function PrinterSettings() {
  const [impressoras, setImpressoras] = useState<ImpressoraEscolhida[]>([]);
  const [escolhida, setEscolhida] = useState<ImpressoraEscolhida | null>(null);
  const [situacao, setSituacao] = useState<{ ligado: boolean; temBluetooth: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [procurando, setProcurando] = useState(false);
  const [testando, setTestando] = useState(false);

  useEffect(() => {
    if (!temImpressora()) return;

    void situacaoDaImpressao().then(setSituacao);
    void lerImpressoraEscolhida().then(setEscolhida);
  }, []);

  if (!temImpressora()) return null;

  async function procurar() {
    setProcurando(true);
    setErro(null);

    try {
      setImpressoras(await listarImpressoras());
      setSituacao(await situacaoDaImpressao());
    } catch (caught) {
      setErro(explicarFalha(caught));
    } finally {
      setProcurando(false);
    }
  }

  async function escolher(impressora: ImpressoraEscolhida) {
    await guardarImpressora(impressora);
    setEscolhida(impressora);
    setAviso(`Os comprovantes deste tablet vão sair na ${impressora.nome}.`);
    setErro(null);
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
      const papel = new Comprovante();
      papel.alinhamento(1).grande(true).negrito(true).linha("RS Pratas");
      papel.grande(false).negrito(false).linha("Teste de impressão").linha();
      papel.alinhamento(0).separador();
      papel.linha(`Impressora: ${escolhida?.nome ?? ""}`);
      papel.linha(new Date().toLocaleString("pt-BR"));
      papel.separador();
      papel.paragrafo("Acentuação: coração, açaí, ANÉIS, pingente, mão.");
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

      {situacao && !situacao.temBluetooth && (
        <div className="mt-4">
          <Alert tone="info">Este tablet não tem Bluetooth. Não há impressora a ligar aqui.</Alert>
        </div>
      )}

      {situacao?.temBluetooth && !situacao.ligado && (
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

      {impressoras.length > 0 && (
        <ul className="mt-4 space-y-2">
          {impressoras.map((impressora) => {
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

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={procurando} onClick={() => void procurar()}>
          <RefreshCw className="h-5 w-5" aria-hidden />
          {procurando ? "Procurando..." : "Procurar impressoras"}
        </Button>

        {escolhida && (
          <Button type="button" disabled={testando} onClick={() => void testar()}>
            {testando ? "Imprimindo..." : "Imprimir teste"}
          </Button>
        )}

        {escolhida && (
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
        )}
      </div>

      <p className="mt-4 border-t border-border pt-4 text-sm text-text-muted">
        A impressora precisa estar pareada nas configurações de Bluetooth do tablet. Isso é feito
        uma vez, quando o balcão é montado.
      </p>
    </section>
  );
}
