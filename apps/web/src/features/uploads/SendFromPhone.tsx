import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Check, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";
import { readDeviceId } from "@/lib/secure-storage";

interface LinkCriado {
  id: string;
  endereco: string;
  expiraEm: string;
  validadeMinutos: number;
}

/**
 * "Enviar pelo celular".
 *
 * O tablet do balcão está em modo quiosque: o seletor de arquivos do Android é
 * outra tela, e o confinamento não deixa abri-la. Então a tela de documentos
 * existia e era inútil justamente no aparelho onde a pessoa passa o dia.
 *
 * Aqui ela toca uma vez, aponta o próprio celular para o QR, fotografa o papel
 * e envia. O tablet percebe sozinho quando chegou — ninguém precisa voltar e
 * apertar "atualizar".
 *
 * Funciona no computador também, e ali é igualmente útil: fotografar um
 * atestado com o celular é mais rápido que digitalizar e procurar o arquivo.
 */
export function SendFromPhone({
  purpose,
  titulo,
  descricao,
  onRecebido,
}: {
  purpose: "DOCUMENTO" | "FOTO";
  titulo: string;
  descricao: string;
  onRecebido?: () => void;
}) {
  const queryClient = useQueryClient();

  const [link, setLink] = useState<LinkCriado | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recebido, setRecebido] = useState(false);

  const pedirLink = useMutation({
    mutationFn: async () => {
      const deviceId = await readDeviceId();

      return apiFetch<LinkCriado>("/api/v1/me/upload-link", {
        method: "POST",
        body: { purpose, ...(deviceId ? { deviceId } : {}) },
      });
    },
    onSuccess: async (criado) => {
      setErro(null);
      setRecebido(false);
      setLink(criado);
      setQr(await QRCode.toDataURL(criado.endereco, { width: 260, margin: 1 }));
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : "Não foi possível gerar o código."),
  });

  /**
   * O tablet fica perguntando se já chegou.
   *
   * Três segundos: a pessoa está com o celular na mão, do outro lado do
   * balcão, e a espera entre enviar e ver "chegou" é o que dá confiança de que
   * funcionou. Para quando chega ou quando o link vence.
   */
  const situacao = useQuery({
    queryKey: ["upload-link", link?.id],
    queryFn: () =>
      apiFetch<{ recebido: boolean; vencido: boolean }>(
        `/api/v1/me/upload-link/${link?.id}/status`,
      ),
    enabled: link !== null && !recebido,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (!situacao.data?.recebido || recebido) return;

    setRecebido(true);
    setQr(null);
    void queryClient.invalidateQueries({ queryKey: ["meu-perfil"] });
    void queryClient.invalidateQueries({ queryKey: ["meus-documentos"] });
    onRecebido?.();
  }, [situacao.data?.recebido, recebido, queryClient, onRecebido]);

  const vencido = situacao.data?.vencido === true;

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="flex items-center gap-2 font-semibold text-text-primary">
        <Smartphone className="h-5 w-5 text-gold-dark" aria-hidden />
        {titulo}
      </h2>
      <p className="mt-1 text-sm text-text-secondary">{descricao}</p>

      {erro && (
        <div className="mt-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}

      {recebido && (
        <div className="mt-4">
          <Alert tone="success" title="Chegou">
            {purpose === "FOTO"
              ? "Sua foto já está no perfil."
              : "O documento entrou na fila de análise da gerência."}
          </Alert>
        </div>
      )}

      {qr && !recebido && (
        <div className="mt-5 flex flex-wrap items-start gap-6">
          {/*
            Fundo branco fixo, e não a cor do tema: no modo escuro um QR de
            módulos escuros sobre fundo escuro simplesmente não é lido pela
            câmera.
          */}
          <div className="rounded-lg bg-white p-3">
            <img src={qr} alt="Código para abrir no celular" className="h-[260px] w-[260px]" />
          </div>

          <div className="flex-1">
            <ol className="space-y-2 text-sm text-text-secondary">
              <li>1. Abra a câmera do seu celular.</li>
              <li>2. Aponte para o código.</li>
              <li>3. Toque no endereço que aparecer.</li>
              <li>
                4. {purpose === "FOTO" ? "Tire a foto ou escolha uma da galeria." : "Fotografe o papel."}
              </li>
            </ol>

            <p className="mt-4 text-sm text-text-muted">
              {vencido
                ? "Este código venceu. Gere outro."
                : `O código vale ${link?.validadeMinutos} minutos e serve uma vez só.`}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {vencido && (
                <Button type="button" onClick={() => pedirLink.mutate()}>
                  Gerar outro código
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLink(null);
                  setQr(null);
                }}
              >
                <X className="h-5 w-5" aria-hidden />
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {!qr && (
        <Button
          type="button"
          className="mt-4"
          disabled={pedirLink.isPending}
          onClick={() => pedirLink.mutate()}
        >
          {recebido ? (
            <>
              <Check className="h-5 w-5" aria-hidden />
              Enviar outro
            </>
          ) : (
            <>
              <Smartphone className="h-5 w-5" aria-hidden />
              {pedirLink.isPending ? "Gerando..." : "Enviar pelo celular"}
            </>
          )}
        </Button>
      )}
    </section>
  );
}
