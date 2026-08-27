import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { passwordSchema } from "@rs-pratas/shared";
import { badRequest } from "../../core/errors.js";
import {
  consumeUploadLink,
  createUploadLink,
  describeUploadLink,
  getUploadLinkStatus,
} from "./upload-link.service.js";
import {
  changeOwnPassword,
  getProfile,
  readPhoto,
  removeOwnPhoto,
  setOwnPhoto,
  updatePreferences,
} from "./profile.service.js";

/**
 * O perfil de quem está logado.
 *
 * Nenhuma rota aqui recebe um identificador de usuário — a única exceção é a
 * leitura da foto, que é o retrato do colega no balcão e não um dado
 * reservado. Tudo o mais opera sobre o dono da sessão, e é isso que garante
 * que ninguém troque a senha de outra pessoa por esta porta.
 */

const preferencesSchema = z.object({
  tema: z.enum(["CLARO", "ESCURO", "SISTEMA"]).optional(),
  /**
   * Só três degraus, e não um controle contínuo.
   *
   * Letra grande num tablet estreito quebra o layout em algum ponto; com três
   * degraus conhecidos dá para garantir que os três funcionam. Um controle
   * livre garantiria só que existe um tamanho em que a tela quebra.
   */
  tamanhoDaLetra: z.union([z.literal(100), z.literal(115), z.literal(130)]).optional(),
  altoContraste: z.boolean().optional(),
  menosMovimento: z.boolean().optional(),
});

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe sua senha atual.").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "As senhas não conferem.",
    path: ["confirmPassword"],
  });

export async function profileRoutes(app: FastifyInstance) {
  app.get("/me/profile", { preHandler: app.requireAuth }, async (request) => getProfile(request));

  app.patch("/me/preferences", { preHandler: app.requireAuth }, async (request) => {
    const input = preferencesSchema.parse(request.body);
    return updatePreferences({ request, ...input });
  });

  app.post("/me/password", { preHandler: app.requireAuth }, async (request) => {
    const input = passwordChangeSchema.parse(request.body);
    return changeOwnPassword({
      request,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });
  });

  app.post("/me/photo", { preHandler: app.requireAuth }, async (request) => {
    const file = await request.file();

    if (!file) {
      throw badRequest("FILE_REQUIRED", "Escolha uma foto para enviar.");
    }

    return setOwnPhoto({
      request,
      content: await file.toBuffer(),
      fileName: file.filename,
      mimeType: file.mimetype,
    });
  });

  app.delete("/me/photo", { preHandler: app.requireAuth }, async (request) =>
    removeOwnPhoto(request),
  );

  /**
   * O link de envio pelo celular.
   *
   * O tablet pede, desenha como QR Code, e fica perguntando se já chegou.
   */
  app.post("/me/upload-link", { preHandler: app.requireAuth }, async (request) => {
    const input = z
      .object({
        purpose: z.enum(["DOCUMENTO", "FOTO"]),
        deviceId: z.string().uuid().optional(),
      })
      .parse(request.body);

    return createUploadLink({ request, ...input });
  });

  app.get("/me/upload-link/:id/status", { preHandler: app.requireAuth }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return getUploadLinkStatus({ request, id });
  });

  /**
   * As duas rotas abertas, sem sessão.
   *
   * Quem chega aqui está no celular da pessoa, fora do sistema. O que autoriza
   * é o token do endereço — sorteado, de uso único e válido por minutos.
   *
   * O limite por minuto é bem mais apertado que o global: é a única porta do
   * sistema que aceita arquivo sem autenticação, e adivinhar token por
   * tentativa é o ataque óbvio contra ela.
   */
  const limiteDeEnvio = {
    rateLimit: { max: 10, timeWindow: "1 minute" },
  };

  app.get("/uploads/:token", { config: limiteDeEnvio }, async (request) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(request.params);
    return describeUploadLink(token);
  });

  app.post("/uploads/:token", { config: limiteDeEnvio }, async (request) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(request.params);
    const file = await request.file();

    if (!file) {
      throw badRequest("FILE_REQUIRED", "Escolha o arquivo para enviar.");
    }

    // Os campos vêm junto do multipart, e são opcionais: a foto não usa
    // nenhum deles.
    const campos = file.fields as Record<string, { value?: string } | undefined>;
    const tipo = campos.documentType?.value;
    const titulo = campos.title?.value;

    return consumeUploadLink({
      token,
      request,
      content: await file.toBuffer(),
      fileName: file.filename,
      mimeType: file.mimetype,
      ...(tipo ? { documentType: tipo as never } : {}),
      ...(titulo ? { title: titulo } : {}),
    });
  });

  /**
   * A foto de um funcionário.
   *
   * Passa pela API em vez de sair de uma pasta pública: arquivo servido
   * estaticamente é arquivo entregue sem passar por autenticação nenhuma.
   *
   * O cache é privado e curto. Sem cache, o tablet baixaria a mesma foto a
   * cada tela; com cache público, ela ficaria no proxy do caminho.
   */
  app.get("/users/:id/photo", { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const conteudo = await readPhoto({ request, userId: id });

    return reply
      .header("Cache-Control", "private, max-age=300")
      .type("image/jpeg")
      .send(conteudo);
  });
}
