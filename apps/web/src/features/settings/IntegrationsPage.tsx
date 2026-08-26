import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Link2,
  Plug,
  RefreshCw,
  Unplug,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { API_BASE_URL, apiFetch, ApiError } from "@/lib/api-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/features/auth/auth-context";
import { lerCodigoDeAutorizacao, limparCodigoDeAutorizacao } from "./authorization-code";
import { LgpdRequests } from "./LgpdRequests";

type Provider = "NUVEMSHOP" | "MERCADOPAGO" | "REDE";
type Status = "DESCONECTADA" | "CONECTADA" | "ERRO";

interface Integration {
  provider: Provider;
  status: Status;
  externalAccountId: string | null;
  storeId: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
  tokenPreview: string | null;
}

interface StoreRow {
  id: string;
  name: string;
}

interface EventRow {
  id: string;
  provider: Provider;
  topic: string;
  externalId: string | null;
  processado: boolean;
  error: string | null;
  createdAt: string;
}

/** Cada serviço pede credenciais diferentes; o formulário segue esta receita. */
const SERVICOS: Record<
  Provider,
  {
    nome: string;
    descricao: string;
    tone: string;
    campos: Array<{ chave: string; rotulo: string; dica?: string }>;
    /** Precisa saber de qual loja sai o estoque enviado ao site. */
    pedeLoja: boolean;
    disponivel: boolean;
  }
> = {
  NUVEMSHOP: {
    nome: "Nuvemshop",
    descricao: "A loja virtual. O estoque daqui alimenta o site, e os pedidos de lá chegam aqui.",
    tone: "bg-ocean-soft text-ocean-dark",
    campos: [
      {
        chave: "appId",
        rotulo: "ID do aplicativo",
        dica: "O número que aparece no painel de desenvolvedor da Nuvemshop.",
      },
      {
        chave: "clientSecret",
        rotulo: "Chave secreta",
        dica: "Usada uma única vez, para trocar a autorização por um token. Não fica guardada.",
      },
      {
        chave: "code",
        rotulo: "Código da autorização",
        dica: "Aparece no endereço depois que você autoriza o aplicativo — o trecho depois de code=.",
      },
    ],
    pedeLoja: true,
    disponivel: true,
  },
  MERCADOPAGO: {
    nome: "Mercado Pago",
    descricao: "Recebimento online e consulta de pagamentos do site.",
    tone: "bg-gold-soft text-gold-dark",
    campos: [
      {
        chave: "accessToken",
        rotulo: "Access token",
        dica: "O token de produção da aplicação — não a chave pública.",
      },
      { chave: "clientId", rotulo: "ID do aplicativo (opcional)" },
      { chave: "publicKey", rotulo: "Chave pública (opcional)" },
    ],
    pedeLoja: false,
    disponivel: true,
  },
  REDE: {
    nome: "Rede / TEF",
    descricao: "Maquininha de cartão integrada ao caixa.",
    tone: "bg-clay-soft text-clay-dark",
    campos: [],
    pedeLoja: false,
    disponivel: false,
  },
};

const STATUS_LABEL: Record<Status, string> = {
  CONECTADA: "Conectada",
  DESCONECTADA: "Não conectada",
  ERRO: "Com erro",
};

/**
 * Os endereços que a Nuvemshop e o Mercado Pago precisam conhecer.
 *
 * Eles carregam o identificador da empresa no meio da URL, que não é coisa que
 * alguém saiba de cabeça. Montar aqui e oferecer o botão de copiar evita o
 * caminho que existia antes: pedir o identificador a quem instalou o sistema.
 *
 * O endereço não é segredo — receber um evento falso não cria venda nenhuma,
 * porque tudo o que chega é conferido depois contra a API do próprio serviço.
 */
function WebhookAddresses() {
  const { user } = useAuth();
  const [copiado, setCopiado] = useState<string | null>(null);

  if (!user) return null;

  // O endereço é o da API, não o do site: quem vai chamar é o servidor do
  // serviço, e ele precisa bater onde o sistema atende de verdade.
  const base = `${API_BASE_URL}/api/v1/integrations`;

  const enderecos = [
    { nome: "Mercado Pago", url: `${base}/mercadopago/webhook/${user.companyId}` },
    { nome: "Nuvemshop", url: `${base}/nuvemshop/webhook/${user.companyId}` },
  ];

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-lg font-medium text-text-primary">Onde eles avisam o sistema</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Cole estes endereços no campo de webhook de cada serviço. É por eles que um pagamento
        aprovado ou um pedido novo chega sozinho, em vez de o sistema ficar perguntando.
      </p>

      <ul className="space-y-2">
        {enderecos.map((endereco) => (
          <li
            key={endereco.nome}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-4 py-3"
          >
            <span className="w-32 shrink-0 font-medium text-text-primary">{endereco.nome}</span>

            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-sm text-text-secondary">
              {endereco.url}
            </code>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(endereco.url);
                setCopiado(endereco.nome);
              }}
            >
              {copiado === endereco.nome ? "Copiado" : "Copiar"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const formatDateTime = (iso: string | null) =>
  iso === null ? "—" : new Date(iso).toLocaleString("pt-BR");

export function IntegrationsPage() {
  const confirmar = useConfirm();
  const queryClient = useQueryClient();

  const [abrindo, setAbrindo] = useState<Provider | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [lojaEscolhida, setLojaEscolhida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const integracoes = useQuery({
    queryKey: ["integrations"],
    queryFn: () => apiFetch<Integration[]>("/api/v1/integrations"),
  });

  const stores = useQuery({
    queryKey: ["stores"],
    queryFn: () => apiFetch<StoreRow[]>("/api/v1/stores"),
  });

  const eventos = useQuery({
    queryKey: ["integration-events"],
    queryFn: () => apiFetch<EventRow[]>("/api/v1/integrations/events"),
  });

  const fechar = () => {
    setAbrindo(null);
    setValores({});
    setLojaEscolhida("");
  };

  /** Abre a autorização da Nuvemshop numa aba nova. */
  const abrirAutorizacao = () => {
    const appId = valores.appId?.trim();

    if (!appId) {
      setError("Informe o ID do aplicativo antes de autorizar.");
      return;
    }

    window.open(`https://www.nuvemshop.com.br/apps/${appId}/authorize`, "_blank", "noopener");
  };

  const conectar = useMutation({
    mutationFn: (provider: Provider) => {
      // A Nuvemshop não entrega token pelo painel: o que ela dá é o par
      // aplicativo + chave secreta, que só vira token depois que o lojista
      // autoriza a instalação. Por isso este provedor tem caminho próprio —
      // usar o par direto na API devolve "Invalid access token".
      if (provider === "NUVEMSHOP") {
        return apiFetch<{ externalAccountId: string }>(
          "/api/v1/integrations/nuvemshop/authorize",
          {
            method: "POST",
            body: {
              appId: valores.appId?.trim() ?? "",
              clientSecret: valores.clientSecret?.trim() ?? "",
              code: valores.code?.trim() ?? "",
              ...(lojaEscolhida ? { storeId: lojaEscolhida } : {}),
            },
          },
        );
      }

      return apiFetch<{ externalAccountId: string }>(
        `/api/v1/integrations/${provider}/connect`,
        {
          method: "POST",
          body: {
            credentials: Object.fromEntries(
              Object.entries(valores).filter(([, valor]) => valor.trim() !== ""),
            ),
            ...(lojaEscolhida ? { storeId: lojaEscolhida } : {}),
          },
        },
      );
    },
    onSuccess: (resultado) => {
      setError(null);
      setAviso(`Conectado. Conta identificada: ${resultado.externalAccountId}.`);
      // O código serve uma vez só; guardá-lo depois de usado só daria a alguém
      // a chance de tentar de novo com um código morto.
      limparCodigoDeAutorizacao();
      fechar();
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível conectar."),
  });

  const testar = useMutation({
    mutationFn: (provider: Provider) =>
      apiFetch<{ conta: string; detalhe: string | null }>(
        `/api/v1/integrations/${provider}/test`,
        { method: "POST" },
      ),
    onSuccess: (resultado) => {
      setError(null);
      setAviso(`Respondeu agora: ${resultado.conta}${resultado.detalhe ? ` (${resultado.detalhe})` : ""}.`);
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "A conexão não respondeu."),
  });

  const desconectar = useMutation({
    mutationFn: (provider: Provider) =>
      apiFetch(`/api/v1/integrations/${provider}`, { method: "DELETE" }),
    onSuccess: () => {
      setError(null);
      setAviso("Desconectado. A credencial foi apagada.");
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível desconectar."),
  });

  /**
   * Traz o que esta na loja virtual para ca.
   *
   * Separado de "Enviar estoque": um le, o outro escreve. O rotulo diz a
   * direcao, porque confundir as duas custa caro — enviar quando se queria
   * receber sobrescreve o site com um estoque que o ERP ainda nao tem.
   */
  const importar = useMutation({
    mutationFn: (oQue: "products" | "customers") =>
      apiFetch<{
        criados: number;
        atualizados: number;
        total: number;
        ignorados: string[];
        semCodigoProprio?: number;
      }>(
        `/api/v1/integrations/nuvemshop/import-${oQue}`,
        { method: "POST" },
      ),
    onSuccess: (resultado) => {
      setError(null);

      // O que ficou de fora vai junto do que entrou. Uma importação que só diz
      // "pronto" esconde os itens sem código, e o dono só descobre a falta
      // quando procura uma peça que nunca chegou.
      const foraDaLista =
        resultado.ignorados.length > 0
          ? ` Ficaram de fora: ${resultado.ignorados.slice(0, 5).join("; ")}${
              resultado.ignorados.length > 5 ? "..." : ""
            }`
          : "";

      // Peça sem código na loja virtual recebe um gerado aqui. Dizer isso
      // explica de onde vieram os códigos "NS-..." que a pessoa vai encontrar
      // no catálogo daqui a pouco.
      const codigosGerados = resultado.semCodigoProprio
        ? ` ${resultado.semCodigoProprio} peça(s) não tinham código na loja virtual e receberam um gerado (NS-...). Você pode trocar por códigos próprios em Produtos, sem risco de duplicar na próxima importação.`
        : "";

      setAviso(
        `${resultado.criados} criado(s) e ${resultado.atualizados} atualizado(s), de ${resultado.total}.${codigosGerados}${foraDaLista}`,
      );

      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível importar."),
  });

  const sincronizar = useMutation({
    mutationFn: () =>
      apiFetch<{ atualizados: number; totalSemCorrespondencia: number; semCorrespondencia: string[] }>(
        "/api/v1/integrations/nuvemshop/sync-stock",
        { method: "POST" },
      ),
    onSuccess: (resultado) => {
      setError(null);
      setAviso(
        resultado.totalSemCorrespondencia > 0
          ? `${resultado.atualizados} variação(ões) atualizadas no site. ${resultado.totalSemCorrespondencia} código(s) existem lá e não existem aqui: ${resultado.semCorrespondencia.slice(0, 8).join(", ")}...`
          : `${resultado.atualizados} variação(ões) atualizadas no site.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : "Não foi possível sincronizar."),
  });

  return (
    <PageShell
      eyebrow="Sistema"
      title="Integrações"
      description="Loja virtual e recebimento online. As credenciais ficam cifradas e nunca voltam para a tela."
    >
      {error && (
        <div className="mb-5">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {aviso && (
        <div className="mb-5">
          <Alert tone="success">{aviso}</Alert>
        </div>
      )}

      {/*
        Quem volta da autorização da Nuvemshop cai aqui sem entender o que
        aconteceu — a barra de endereço já foi limpa e a tela é a mesma de
        antes. Este aviso diz que o passo funcionou e qual é o próximo.
      */}
      {lerCodigoDeAutorizacao() && !abrindo && (
        <div className="mb-5">
          <Alert tone="info" title="Autorização da Nuvemshop recebida">
            Falta o ID do aplicativo e a chave secreta. Clique em Conectar no Nuvemshop abaixo — o
            código já vai preenchido. Ele vale poucos minutos.
          </Alert>
        </div>
      )}

      <ul className="space-y-4">
        {integracoes.data?.map((integracao) => {
          const servico = SERVICOS[integracao.provider];
          const conectada = integracao.status === "CONECTADA";

          return (
            <li
              key={integracao.provider}
              className="rounded-lg border border-border bg-surface p-5 shadow-soft"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${servico.tone}`}
                    aria-hidden
                  >
                    <Plug className="h-5 w-5" />
                  </span>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium text-text-primary">{servico.nome}</h2>
                      <span
                        className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm ${
                          conectada
                            ? "bg-sage-soft text-sage-dark"
                            : integracao.status === "ERRO"
                              ? "bg-rose-soft text-rose-dark"
                              : "bg-background-secondary text-text-muted"
                        }`}
                      >
                        {conectada ? (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        ) : integracao.status === "ERRO" ? (
                          <XCircle className="h-3.5 w-3.5" aria-hidden />
                        ) : null}
                        {STATUS_LABEL[integracao.status]}
                      </span>
                      {!servico.disponivel && (
                        <span className="rounded-full bg-background-secondary px-2.5 py-0.5 text-sm text-text-muted">
                          Em breve
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-sm text-text-secondary">{servico.descricao}</p>

                    {conectada && (
                      <p className="mt-1 text-sm text-text-muted">
                        Conta {integracao.externalAccountId} · token {integracao.tokenPreview} ·
                        conectada em {formatDateTime(integracao.connectedAt)}
                        {integracao.lastSyncAt
                          ? ` · última sincronização ${formatDateTime(integracao.lastSyncAt)}`
                          : ""}
                      </p>
                    )}

                    {integracao.lastError && (
                      <p className="mt-1 text-sm text-warning">{integracao.lastError}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {servico.disponivel && !conectada && abrindo !== integracao.provider && (
                    <Button
                      type="button"
                      onClick={() => {
                        setAbrindo(integracao.provider);

                        // Quem acabou de voltar da autorização já tem o código
                        // guardado — preencher poupa a ida à barra de endereço,
                        // que a essa altura nem mostra mais o código.
                        const codigo =
                          integracao.provider === "NUVEMSHOP" ? lerCodigoDeAutorizacao() : null;

                        setValores(codigo ? { code: codigo } : {});
                      }}
                    >
                      <Link2 className="h-5 w-5" aria-hidden />
                      Conectar
                    </Button>
                  )}

                  {conectada && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={testar.isPending}
                        onClick={() => testar.mutate(integracao.provider)}
                      >
                        {testar.isPending ? "Testando..." : "Testar"}
                      </Button>

                      {integracao.provider === "NUVEMSHOP" && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={sincronizar.isPending}
                          onClick={() => sincronizar.mutate()}
                        >
                          <RefreshCw className="h-5 w-5" aria-hidden />
                          {sincronizar.isPending ? "Enviando..." : "Enviar estoque"}
                        </Button>
                      )}

                      {integracao.provider === "NUVEMSHOP" && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={importar.isPending}
                            onClick={() => importar.mutate("products")}
                          >
                            <Download className="h-5 w-5" aria-hidden />
                            Trazer produtos
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={importar.isPending}
                            onClick={() => importar.mutate("customers")}
                          >
                            <Users className="h-5 w-5" aria-hidden />
                            Trazer clientes
                          </Button>
                        </>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        onClick={async () => {
                          if (
                            (await confirmar({
                              titulo: `Desconectar ${servico.nome}?`,
                              descricao:
                                "A credencial é apagada. Para voltar, você precisa colá-la de novo — e, no caso da Nuvemshop, autorizar o aplicativo outra vez.",
                              acao: "Desconectar",
                              destrutivo: true,
                            })) !== null
                          ) {
                            desconectar.mutate(integracao.provider);
                          }
                        }}
                      >
                        <Unplug className="h-5 w-5" aria-hidden />
                        Desconectar
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {abrindo === integracao.provider && (
                <form
                  className="mt-4 border-t border-border/70 pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    conectar.mutate(integracao.provider);
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    {servico.campos.map((campo) => (
                      <Field
                        key={campo.chave}
                        label={campo.rotulo}
                        value={valores[campo.chave] ?? ""}
                        onChange={(event) =>
                          setValores({ ...valores, [campo.chave]: event.target.value })
                        }
                        {...(campo.dica ? { hint: campo.dica } : {})}
                      />
                    ))}

                    {servico.pedeLoja && (
                      <div>
                        <label
                          htmlFor="loja-origem"
                          className="mb-1 block text-sm font-medium text-text-primary"
                        >
                          Loja que abastece o site
                        </label>
                        <select
                          id="loja-origem"
                          required
                          value={lojaEscolhida}
                          onChange={(event) => setLojaEscolhida(event.target.value)}
                          className="min-h-[48px] w-full rounded-md border border-border bg-surface px-3 text-text-primary"
                        >
                          <option value="">Selecione</option>
                          {stores.data?.map((loja) => (
                            <option key={loja.id} value={loja.id}>
                              {loja.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-sm text-text-muted">
                          É o estoque dela que vai para a loja virtual.
                        </p>
                      </div>
                    )}
                  </div>

                  {integracao.provider === "NUVEMSHOP" && (
                    <p className="mt-3 rounded-md bg-ocean-soft/50 p-3 text-sm text-text-secondary">
                      Preencha o ID do aplicativo, clique em <strong>Autorizar na Nuvemshop</strong>,
                      aprove o acesso na aba que abrir e copie da barra de endereço o trecho depois
                      de <code>code=</code>. Cole aqui junto com a chave secreta.
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {integracao.provider === "NUVEMSHOP" && (
                      <Button type="button" variant="outline" onClick={abrirAutorizacao}>
                        <ExternalLink className="h-5 w-5" aria-hidden />
                        Autorizar na Nuvemshop
                      </Button>
                    )}
                    <Button type="submit" disabled={conectar.isPending}>
                      {conectar.isPending ? "Verificando..." : "Conectar"}
                    </Button>
                    <Button type="button" variant="outline" onClick={fechar}>
                      Cancelar
                    </Button>
                  </div>

                  <p className="mt-3 text-sm text-text-muted">
                    A credencial é testada contra o serviço antes de ser salva — se o token estiver
                    errado, você fica sabendo agora e não daqui a uma semana.
                  </p>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <LgpdRequests />

      <WebhookAddresses />

      {(eventos.data?.length ?? 0) > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-medium text-text-primary">O que chegou de fora</h2>
          <ul className="space-y-2">
            {eventos.data?.slice(0, 20).map((evento) => (
              <li
                key={evento.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-4 py-2.5 text-sm"
              >
                <span className="text-text-secondary">
                  <span className="font-medium text-text-primary">
                    {SERVICOS[evento.provider].nome}
                  </span>{" "}
                  · {evento.topic}
                  {evento.externalId ? ` · ${evento.externalId}` : ""}
                </span>
                <span className="text-text-muted">{formatDateTime(evento.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}
