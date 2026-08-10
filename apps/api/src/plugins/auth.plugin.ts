import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { forbidden, unauthorized } from "../core/errors.js";
import type { AccessTokenPayload } from "../modules/auth/auth.service.js";
import type { OnboardingTokenPayload } from "../modules/auth/first-access.service.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    /** Sessão normal ou token de propósito único do primeiro acesso. */
    payload: AccessTokenPayload | OnboardingTokenPayload;
    /** Após requireAuth, só um token de sessão real chega aos handlers. */
    user: AccessTokenPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    /** preHandler que exige um access token válido. */
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * O perfil DESENVOLVEDOR existe para dar suporte técnico com visão total dos
 * dados — nunca para alterá-los. Redundante de propósito com o catálogo de
 * permissões (que só concede códigos de visualização a esse perfil): se alguém
 * conceder uma permissão de escrita por engano, esta guarda barra antes.
 */
async function blockWriteForDeveloper(request: FastifyRequest): Promise<void> {
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);

  if (isWrite && request.user.role === "DESENVOLVEDOR") {
    throw forbidden(
      "DEVELOPER_READ_ONLY",
      "O modo desenvolvedor é somente leitura — nenhuma alteração é permitida.",
    );
  }
}

/**
 * 2FA obrigatório para o DONO: enquanto não confirmar o segundo fator, a sessão
 * só abre as rotas de configuração de 2FA e a saída. Sem esse bloqueio,
 * "obrigatório" viraria uma sugestão que se pode adiar indefinidamente.
 */
async function enforceTwoFactorForOwner(request: FastifyRequest): Promise<void> {
  if (request.user.role !== "DONO") {
    return;
  }

  const allowedPrefixes = ["/api/v1/auth/2fa", "/api/v1/auth/logout", "/api/v1/auth/me"];
  if (allowedPrefixes.some((prefix) => request.url.startsWith(prefix))) {
    return;
  }

  const credential = await prisma.twoFactorCredential.findUnique({
    where: { userId: request.user.sub },
    select: { confirmedAt: true },
  });

  if (!credential?.confirmedAt) {
    throw forbidden(
      "TWO_FACTOR_SETUP_REQUIRED",
      "Configure a verificação em duas etapas para continuar.",
    );
  }
}

export const authPlugin = fp(async (app) => {
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: {
      iss: env.JWT_ISSUER,
      expiresIn: env.JWT_ACCESS_TTL,
    },
    verify: {
      allowedIss: env.JWT_ISSUER,
    },
  });

  app.decorate("requireAuth", async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      throw unauthorized("UNAUTHENTICATED", "Sessão inválida ou expirada. Entre novamente.");
    }

    // Tokens de propósito único (primeiro acesso) são assinados com o mesmo
    // segredo, mas não carregam sessionId. Sem esta checagem, um token de
    // onboarding — obtido só com a senha temporária — abriria as rotas normais
    // da aplicação.
    const payload = request.user as Partial<AccessTokenPayload> & { scope?: string };

    if (payload.scope || !payload.sessionId) {
      throw unauthorized("UNAUTHENTICATED", "Sessão inválida ou expirada. Entre novamente.");
    }

    // As guardas abaixo vivem aqui, e não em hooks globais, por causa da ordem
    // de execução do Fastify: um hook global de preHandler roda ANTES do
    // preHandler da rota, quando request.user ainda está vazio — e a guarda
    // silenciosamente nunca dispararia. Dentro do requireAuth elas rodam logo
    // após a verificação do token, e valem para toda rota autenticada.
    await blockWriteForDeveloper(request);
    await enforceTwoFactorForOwner(request);
  });
});
