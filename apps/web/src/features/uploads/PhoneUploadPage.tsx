import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, CheckCircle2, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Logo } from "@/components/ui/logo";
import { apiFetch, ApiError, API_BASE_URL } from "@/lib/api-client";

interface Convite {
  nome: string;
  finalidade: "DOCUMENTO" | "FOTO";
  expiraEm: string;
}

const TIPOS = [
  { valor: "MEDICAL_CERTIFICATE", rotulo: "Atestado médico" },
  { valor: "HOURS_PROOF", rotulo: "Comprovante de horas" },
  { valor: "ABSENCE_JUSTIFICATION", rotulo: "Justificativa de falta" },
  { valor: "OTHER", rotulo: "Outro documento" },
] as const;

/**
 * A página que abre no celular do funcionário.
 *
 * Fora do sistema, sem login. O que autoriza é o token do endereço, que veio
 * do QR Code na tela do tablet — sorteado, de uso único e válido por minutos.
 *
 * Precisa ser a tela mais simples do sistema. Quem chega aqui está em pé,
 * segurando um papel numa mão e o celular na outra, e não veio aprender a usar
 * nada: escolhe o que é, fotografa, envia. Sem menu, sem navegação, sem nada
 * que leve para outro lugar.
 */
export function PhoneUploadPage() {
  const { token = "" } = useParams();
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  const [escolhido, setEscolhido] = useState<File | null>(null);
  const [tipo, setTipo] = useState<string>("MEDICAL_CERTIFICATE");
  const [titulo, setTitulo] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState<string | null>(null);

  const convite = useQuery({
    queryKey: ["convite-envio", token],
    queryFn: () => apiFetch<Convite>(`/api/v1/uploads/${token}`, { skipAuthRetry: true }),
    retry: false,
  });

  const enviar = useMutation({
    mutationFn: async () => {
      if (!escolhido) throw new Error("Escolha o arquivo.");

      const corpo = new FormData();

      // Os campos vêm ANTES do arquivo de propósito: o servidor lê o multipart
      // em ordem, e um campo depois do arquivo não chega junto dele.
      if (convite.data?.finalidade === "DOCUMENTO") {
        corpo.append("documentType", tipo);
        corpo.append("title", titulo.trim());
        if (de) corpo.append("referenceStart", de);
        if (ate) corpo.append("referenceEnd", ate);
      }
      corpo.append("file", escolhido);

      const resposta = await fetch(`${API_BASE_URL}/api/v1/uploads/${token}`, {
        method: "POST",
        body: corpo,
      });

      const corpoResposta = (await resposta.json().catch(() => null)) as
        | { mensagem?: string; error?: { message?: string } }
        | null;

      if (!resposta.ok) {
        throw new Error(corpoResposta?.error?.message ?? "Não foi possível enviar.");
      }

      return corpoResposta?.mensagem ?? "Enviado.";
    },
    onSuccess: (mensagem) => {
      setErro(null);
      setPronto(mensagem);
    },
    onError: (caught) =>
      setErro(caught instanceof ApiError ? caught.message : (caught as Error).message),
  });

  const foto = convite.data?.finalidade === "FOTO";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 bg-background p-5">
      <Logo size="sm" className="self-start" />

      {convite.isPending && <p className="text-text-secondary">Abrindo...</p>}

      {convite.isError && (
        <Alert tone="error" title="Este link não vale mais">
          Os códigos duram poucos minutos e servem uma vez só — é isso que os torna seguros. Gere
          outro no tablet.
        </Alert>
      )}

      {pronto && (
        <Alert tone="success" title="Enviado">
          <p className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            {pronto}
          </p>
          <p className="mt-2 text-sm">Pode fechar esta página.</p>
        </Alert>
      )}

      {convite.data && !pronto && (
        <>
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">
              Olá, {convite.data.nome}
            </h1>
            <p className="mt-1 text-text-secondary">
              {foto
                ? "Escolha a foto que vai aparecer no seu perfil."
                : "Fotografe o documento e envie. A gerência recebe para analisar."}
            </p>
          </div>

          {erro && <Alert tone="error">{erro}</Alert>}

          {!foto && (
            <>
              <div>
                <label
                  htmlFor="tipo"
                  className="text-sm font-medium text-text-secondary"
                >
                  O que é
                </label>
                <select
                  id="tipo"
                  value={tipo}
                  onChange={(event) => setTipo(event.target.value)}
                  className="mt-1.5 min-h-[52px] w-full rounded-md border border-border bg-surface px-4 text-base"
                >
                  {TIPOS.map((opcao) => (
                    <option key={opcao.valor} value={opcao.valor}>
                      {opcao.rotulo}
                    </option>
                  ))}
                </select>
              </div>

              <Field
                label="Descrição"
                value={titulo}
                onChange={(event) => setTitulo(event.target.value)}
                placeholder="Ex.: Atestado de 2 dias"
                required
                minLength={3}
              />

              {/*
                O período que o documento cobre — os mesmos campos do
                formulário do computador.
                Num atestado é o que mais importa: são os dias de afastamento,
                e é por eles que o gerente confere a falta no espelho de ponto.
                Sem isso o documento chega como uma foto sem contexto, e alguém
                precisa abrir o arquivo e ler à mão para saber de quando é.
              */}
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Válido de"
                  type="date"
                  value={de}
                  onChange={(event) => setDe(event.target.value)}
                  hint={
                    tipo === "MEDICAL_CERTIFICATE" ? "Primeiro dia de afastamento." : undefined
                  }
                />
                <Field
                  label="Válido até"
                  type="date"
                  value={ate}
                  onChange={(event) => setAte(event.target.value)}
                />
              </div>
            </>
          )}

          {/*
            Dois campos, e não um.
            `capture` abre a câmera direto — é o caminho de quem está com o
            papel na mão. Só que ele também ESCONDE a galeria: quem já tinha a
            foto no celular ficava sem jeito de escolhê-la, obrigado a
            fotografar o papel de novo. O segundo campo, sem `capture`, abre o
            que o aparelho tiver: galeria, arquivos, nuvem.
          */}
          <input
            ref={camera}
            type="file"
            accept={foto ? "image/*" : "image/*,application/pdf"}
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const arquivoEscolhido = event.target.files?.[0];
              if (arquivoEscolhido) setEscolhido(arquivoEscolhido);
              event.target.value = "";
            }}
          />

          <input
            ref={galeria}
            type="file"
            accept={foto ? "image/*" : "image/*,application/pdf"}
            className="hidden"
            onChange={(event) => {
              const arquivoEscolhido = event.target.files?.[0];
              if (arquivoEscolhido) setEscolhido(arquivoEscolhido);
              event.target.value = "";
            }}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => camera.current?.click()}
            >
              <Camera className="h-6 w-6" aria-hidden />
              {foto ? "Tirar agora" : "Fotografar"}
            </Button>

            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => galeria.current?.click()}
            >
              <Images className="h-6 w-6" aria-hidden />
              {foto ? "Escolher da galeria" : "Escolher arquivo"}
            </Button>
          </div>

          {escolhido && (
            <p className="-mt-3 truncate text-sm text-text-muted">
              {escolhido.name} · {Math.round(escolhido.size / 1024)} KB
            </p>
          )}

          <Button
            type="button"
            size="lg"
            disabled={!escolhido || enviar.isPending || (!foto && titulo.trim().length < 3)}
            onClick={() => enviar.mutate()}
          >
            {enviar.isPending ? "Enviando..." : "Enviar"}
          </Button>

          <p className="mt-auto text-center text-sm text-text-muted">
            Este endereço vale só para este envio e some depois.
          </p>
        </>
      )}
    </main>
  );
}
