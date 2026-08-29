import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { apiFetch, ApiError } from "@/lib/api-client";

interface EstadoDoEmail {
  ligado: boolean;
  remetente: string;
  servidor: string | null;
}

/**
 * O e-mail está ligado?
 *
 * O sistema nunca deixa uma falha de envio derrubar o que já deu certo — o
 * funcionário é cadastrado mesmo que o e-mail não saia, e a venda fecha mesmo
 * que o comprovante não chegue. É a decisão certa, e tem um efeito colateral:
 * ninguém descobre que o e-mail está desligado até um cliente reclamar que não
 * recebeu.
 *
 * Este cartão é o antídoto. Diz o estado sem rodeio e oferece o teste.
 *
 * O teste vai para o e-mail de quem clicou, e aceita outro endereço quando
 * pedido: a pergunta que se faz aqui não é só "o envio funciona?", é "chega, ou
 * cai no spam?" — e isso muda conforme o provedor de quem recebe.
 */
export function EmailStatus() {
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [outro, setOutro] = useState("");

  const estado = useQuery({
    queryKey: ["email-status"],
    queryFn: () => apiFetch<EstadoDoEmail>("/api/v1/settings/email"),
  });

  const testar = useMutation({
    mutationFn: () =>
      apiFetch<{ para: string }>("/api/v1/settings/email/test", {
        method: "POST",
        body: outro.trim() ? { para: outro.trim() } : {},
      }),
    onSuccess: (resposta) => {
      setErro(null);
      setResultado(`Enviado para ${resposta.para}. Confira a caixa de entrada e o spam.`);
    },
    onError: (caught) => {
      setResultado(null);
      // Erro que não é do servidor quase sempre é a espera estourando antes
      // da resposta. Dizer isso evita mexer na credencial por causa da rede.
      setErro(
        caught instanceof ApiError
          ? caught.message
          : "O servidor não respondeu a tempo. Tente de novo em alguns instantes.",
      );
    },
  });

  if (!estado.data) return null;

  const ligado = estado.data.ligado;

  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${
              ligado ? "bg-sage-soft text-sage" : "bg-warning/10 text-warning"
            }`}
            aria-hidden
          >
            {ligado ? <Mail className="h-5 w-5" /> : <MailX className="h-5 w-5" />}
          </span>

          <div>
            <p className="font-medium text-text-primary">
              {ligado ? "Envio de e-mail ligado" : "Envio de e-mail desligado"}
            </p>

            <p className="mt-0.5 text-sm text-text-secondary">
              {ligado
                ? `Sai como ${estado.data.remetente}${
                    estado.data.servidor ? ` · ${estado.data.servidor}` : ""
                  }`
                : "Comprovante, garantia e credencial de funcionário ficam só na tela. Nada é enviado."}
            </p>

            {!ligado && (
              <p className="mt-2 max-w-2xl text-sm text-text-muted">
                Para ligar, preencha no painel do Render (serviço da API, aba Environment):{" "}
                <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>,{" "}
                <code>SMTP_PASSWORD</code> e <code>MAIL_FROM</code>. Os quatro primeiros vêm do
                provedor da caixa de e-mail da loja; o último é o endereço que o cliente vê.
              </p>
            )}
          </div>
        </div>

        {ligado && (
          <div className="flex flex-wrap items-end gap-3">
            <Field
              label="Mandar o teste para"
              type="email"
              value={outro}
              onChange={(evento) => setOutro(evento.target.value)}
              placeholder="seu e-mail"
              hint="Deixe em branco para mandar ao e-mail da sua conta."
              className="min-w-[16rem]"
            />

            <Button type="button" disabled={testar.isPending} onClick={() => testar.mutate()}>
              {testar.isPending ? "Enviando..." : "Enviar teste"}
            </Button>
          </div>
        )}
      </div>

      {resultado && (
        <div className="mt-4">
          <Alert tone="success">{resultado}</Alert>
        </div>
      )}

      {erro && (
        <div className="mt-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}
    </section>
  );
}
