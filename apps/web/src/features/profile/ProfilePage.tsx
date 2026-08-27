import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Camera, Eye, KeyRound, Moon, Sun, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { PageShell } from "@/components/ui/page-shell";
import { apiFetch, ApiError, API_BASE_URL, getAccessToken } from "@/lib/api-client";
import { useAuth } from "../auth/auth-context";
import { SendFromPhone } from "@/features/uploads/SendFromPhone";
import { aplicarPreferencias, guardarPreferencias, type Preferencias } from "./apply-preferences";

interface Perfil {
  id: string;
  nome: string;
  matricula: string;
  email: string | null;
  perfil: string;
  lojas: string[];
  temFoto: boolean;
  ultimoAcesso: string | null;
  pinTrocadoEm: string | null;
  preferencias: {
    tema: "CLARO" | "ESCURO" | "SISTEMA";
    tamanhoDaLetra: number;
    altoContraste: boolean;
    menosMovimento: boolean;
  };
}

const TAMANHOS = [
  { valor: 100, rotulo: "Normal" },
  { valor: 115, rotulo: "Maior" },
  { valor: 130, rotulo: "Grande" },
] as const;

const PERFIS: Record<string, string> = {
  VENDEDOR: "Vendedor",
  GERENTE: "Gerente",
  DONO: "Dono",
  DESENVOLVEDOR: "Suporte técnico",
};

/**
 * O perfil de quem está logado.
 *
 * Reúne o que era espalhado ou não existia: trocar a própria senha não tinha
 * tela nenhuma — quem desconfiava que alguém viu a senha dela precisava pedir
 * ao dono e esperar. O PIN tinha tela, mas escondida atrás de um aviso de
 * vencimento.
 *
 * Os ajustes de visão ficam aqui porque são pessoais, e a escolha viaja com a
 * matrícula: quem prefere a tela escura ou a letra grande encontra o sistema
 * do jeito dela em qualquer tablet da rede.
 */
export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const arquivo = useRef<HTMLInputElement>(null);

  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [senhaConfirma, setSenhaConfirma] = useState("");

  /** Muda a cada troca de foto para o navegador não servir a antiga do cache. */
  const [versaoDaFoto, setVersaoDaFoto] = useState(() => Date.now());

  const perfil = useQuery({
    queryKey: ["meu-perfil"],
    queryFn: () => apiFetch<Perfil>("/api/v1/me/profile"),
  });

  function falhou(caught: unknown, padrao: string) {
    setAviso(null);
    setErro(caught instanceof ApiError ? caught.message : padrao);
  }

  /**
   * Salvar já aplicando na tela.
   *
   * A pessoa marca "letra grande" e vê a letra crescer no mesmo instante — é
   * assim que ela descobre se era isso que queria. Esperar a resposta do
   * servidor para mostrar a mudança transformaria um ajuste em um formulário.
   */
  const salvarPreferencias = useMutation({
    mutationFn: (mudanca: Partial<Perfil["preferencias"]>) =>
      apiFetch("/api/v1/me/preferences", { method: "PATCH", body: mudanca }),
    onMutate: (mudanca) => {
      const atual = perfil.data?.preferencias;
      if (!atual) return;

      const novas = { ...atual, ...mudanca };

      const paraAplicar: Preferencias = {
        theme: novas.tema,
        fontScale: novas.tamanhoDaLetra,
        highContrast: novas.altoContraste,
        reduceMotion: novas.menosMovimento,
      };

      aplicarPreferencias(paraAplicar);
      guardarPreferencias(paraAplicar);

      queryClient.setQueryData<Perfil>(["meu-perfil"], (velho) =>
        velho ? { ...velho, preferencias: novas } : velho,
      );
    },
    onError: (caught) => {
      falhou(caught, "Não foi possível salvar a preferência.");
      void perfil.refetch();
    },
  });

  const trocarSenha = useMutation({
    mutationFn: () =>
      apiFetch<{ mensagem: string }>("/api/v1/me/password", {
        method: "POST",
        body: {
          currentPassword: senhaAtual,
          newPassword: senhaNova,
          confirmPassword: senhaConfirma,
        },
      }),
    onSuccess: (resultado) => {
      setErro(null);
      setAviso(resultado.mensagem);
      setSenhaAtual("");
      setSenhaNova("");
      setSenhaConfirma("");
    },
    onError: (caught) => falhou(caught, "Não foi possível trocar a senha."),
  });

  /**
   * O envio da foto vai de `fetch` direto, e não pelo apiFetch.
   *
   * O corpo é multipart, e o cliente da casa monta JSON. Deixar o navegador
   * definir o Content-Type é obrigatório aqui: ele precisa incluir a fronteira
   * do multipart, que só ele conhece.
   */
  const enviarFoto = useMutation({
    mutationFn: async (file: File) => {
      const corpo = new FormData();
      corpo.append("file", file);

      const resposta = await fetch(`${API_BASE_URL}/api/v1/me/photo`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
        body: corpo,
      });

      if (!resposta.ok) {
        const erro = (await resposta.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(erro?.error?.message ?? "A foto não foi aceita.");
      }
    },
    onSuccess: () => {
      setErro(null);
      setAviso("Foto atualizada.");
      setVersaoDaFoto(Date.now());
      void queryClient.invalidateQueries({ queryKey: ["meu-perfil"] });
    },
    onError: (caught) => falhou(caught, "Não foi possível enviar a foto."),
  });

  const removerFoto = useMutation({
    mutationFn: () => apiFetch("/api/v1/me/photo", { method: "DELETE" }),
    onSuccess: () => {
      setErro(null);
      setAviso("Foto removida.");
      setVersaoDaFoto(Date.now());
      void queryClient.invalidateQueries({ queryKey: ["meu-perfil"] });
    },
    onError: (caught) => falhou(caught, "Não foi possível remover a foto."),
  });

  const dados = perfil.data;
  const prefs = dados?.preferencias;

  const iniciais = (dados?.nome ?? user?.name ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <PageShell title="Meu perfil" description="Seus dados, sua senha e como você vê o sistema.">
      {erro && (
        <div className="mb-5">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}

      {aviso && (
        <div className="mb-5">
          <Alert tone="success">{aviso}</Alert>
        </div>
      )}

      {dados && (
        <div className="space-y-6">
          {/* ------------------------------------------------ identificação */}
          <section className="rounded-lg border border-border bg-surface p-6">
            <div className="flex flex-wrap items-center gap-5">
              {dados.temFoto ? (
                <img
                  src={`${API_BASE_URL}/api/v1/users/${dados.id}/photo?v=${versaoDaFoto}`}
                  alt={`Foto de ${dados.nome}`}
                  className="h-24 w-24 rounded-full border border-border object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-24 w-24 items-center justify-center rounded-full bg-rose-soft text-2xl font-semibold text-rose-primary"
                >
                  {iniciais}
                </span>
              )}

              <div className="flex-1">
                <h2 className="text-xl font-semibold text-text-primary">{dados.nome}</h2>
                <p className="text-text-secondary">
                  {PERFIS[dados.perfil] ?? dados.perfil} · matrícula {dados.matricula}
                </p>
                {dados.lojas.length > 0 && (
                  <p className="text-sm text-text-muted">{dados.lojas.join(" · ")}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={arquivo}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const escolhido = event.target.files?.[0];
                    if (escolhido) enviarFoto.mutate(escolhido);
                    // Zera para a mesma foto poder ser escolhida de novo depois
                    // de um erro — sem isto o campo não dispara duas vezes.
                    event.target.value = "";
                  }}
                />

                <Button
                  type="button"
                  variant="outline"
                  disabled={enviarFoto.isPending}
                  onClick={() => arquivo.current?.click()}
                >
                  <Camera className="h-5 w-5" aria-hidden />
                  {enviarFoto.isPending ? "Enviando..." : dados.temFoto ? "Trocar foto" : "Pôr foto"}
                </Button>

                {dados.temFoto && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={removerFoto.isPending}
                    onClick={() => removerFoto.mutate()}
                  >
                    <Trash2 className="h-5 w-5" aria-hidden />
                    Remover
                  </Button>
                )}
              </div>
            </div>

            <p className="mt-4 border-t border-border pt-4 text-sm text-text-muted">
              A foto serve para reconhecer quem está usando o tablet do balcão, que troca de pessoa
              várias vezes por dia. Não é obrigatória.
            </p>
          </section>

          {/*
            No tablet este é o ÚNICO caminho: o modo quiosque não deixa abrir o
            seletor de arquivos do Android. No computador ele continua sendo o
            mais rápido — a foto costuma estar no celular, não no disco.
          */}
          <SendFromPhone
            purpose="FOTO"
            titulo="Enviar foto pelo celular"
            descricao="Aponte a câmera do seu celular para o código e escolha a foto por lá."
            onRecebido={() => setVersaoDaFoto(Date.now())}
          />

          {/* --------------------------------------------------- como eu vejo */}
          <section className="rounded-lg border border-border bg-surface p-6">
            <h2 className="flex items-center gap-2 font-semibold text-text-primary">
              <Eye className="h-5 w-5 text-gold-dark" aria-hidden />
              Como você vê o sistema
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Vale para você, em qualquer tablet ou computador da rede.
            </p>

            {prefs && (
              <div className="mt-5 space-y-6">
                <fieldset>
                  <legend className="text-sm font-medium text-text-secondary">Cores</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        { valor: "CLARO", rotulo: "Clara", icone: Sun },
                        { valor: "ESCURO", rotulo: "Escura", icone: Moon },
                        { valor: "SISTEMA", rotulo: "Como o aparelho", icone: Eye },
                      ] as const
                    ).map((opcao) => {
                      const Icone = opcao.icone;
                      const ativo = prefs.tema === opcao.valor;

                      return (
                        <Button
                          key={opcao.valor}
                          type="button"
                          variant={ativo ? "primary" : "outline"}
                          aria-pressed={ativo}
                          onClick={() => salvarPreferencias.mutate({ tema: opcao.valor })}
                        >
                          <Icone className="h-5 w-5" aria-hidden />
                          {opcao.rotulo}
                        </Button>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                    <Type className="h-4 w-4" aria-hidden />
                    Tamanho da letra
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {TAMANHOS.map((opcao) => {
                      const ativo = prefs.tamanhoDaLetra === opcao.valor;

                      return (
                        <Button
                          key={opcao.valor}
                          type="button"
                          variant={ativo ? "primary" : "outline"}
                          aria-pressed={ativo}
                          onClick={() =>
                            salvarPreferencias.mutate({ tamanhoDaLetra: opcao.valor })
                          }
                        >
                          {opcao.rotulo}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-sm text-text-muted">
                    Cresce a tela toda junto com a letra — botões e espaços incluídos.
                  </p>
                </fieldset>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={prefs.altoContraste}
                    onChange={(event) =>
                      salvarPreferencias.mutate({ altoContraste: event.target.checked })
                    }
                    className="mt-1 h-5 w-5 accent-rose-primary"
                  />
                  <span>
                    <span className="font-medium text-text-primary">Mais contraste</span>
                    <span className="block text-sm text-text-secondary">
                      Escurece os textos secundários e as bordas. Ajuda no quiosque com sol batendo
                      na tela.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={prefs.menosMovimento}
                    onChange={(event) =>
                      salvarPreferencias.mutate({ menosMovimento: event.target.checked })
                    }
                    className="mt-1 h-5 w-5 accent-rose-primary"
                  />
                  <span>
                    <span className="font-medium text-text-primary">Menos movimento</span>
                    <span className="block text-sm text-text-secondary">
                      Desliga as animações. Para quem sente enjoo e para os tablets mais lentos.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </section>

          {/* ---------------------------------------------------------- senha */}
          <section className="rounded-lg border border-border bg-surface p-6">
            <h2 className="flex items-center gap-2 font-semibold text-text-primary">
              <KeyRound className="h-5 w-5 text-gold-dark" aria-hidden />
              Trocar minha senha
            </h2>

            <form
              className="mt-4 flex max-w-md flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                trocarSenha.mutate();
              }}
            >
              <Field
                label="Senha atual"
                type="password"
                value={senhaAtual}
                onChange={(event) => setSenhaAtual(event.target.value)}
                autoComplete="current-password"
                hint="Pedimos a atual porque um tablet destravado não pode bastar para trocar sua senha."
                required
              />
              <Field
                label="Nova senha"
                type="password"
                value={senhaNova}
                onChange={(event) => setSenhaNova(event.target.value)}
                autoComplete="new-password"
                hint={
                  senhaNova.length > 0 && senhaNova.length < 12
                    ? `Faltam ${12 - senhaNova.length} caractere(s).`
                    : "Ao menos 12 caracteres."
                }
                required
              />
              <Field
                label="Confirme a nova senha"
                type="password"
                value={senhaConfirma}
                onChange={(event) => setSenhaConfirma(event.target.value)}
                autoComplete="new-password"
                error={
                  senhaConfirma.length > 0 && senhaConfirma !== senhaNova
                    ? "As senhas não conferem."
                    : undefined
                }
                required
              />

              <Button
                type="submit"
                disabled={
                  trocarSenha.isPending || senhaNova.length < 12 || senhaNova !== senhaConfirma
                }
              >
                {trocarSenha.isPending ? "Trocando..." : "Trocar senha"}
              </Button>
            </form>

            <div className="mt-5 border-t border-border pt-5">
              <p className="text-sm text-text-secondary">
                O PIN é o que você digita no tablet — outra credencial, trocada em outra tela.
                {dados.pinTrocadoEm &&
                  ` O seu foi trocado em ${new Date(dados.pinTrocadoEm).toLocaleDateString("pt-BR")}.`}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={() => navigate("/trocar-pin")}
              >
                Trocar meu PIN
              </Button>
            </div>
          </section>
        </div>
      )}
    </PageShell>
  );
}
