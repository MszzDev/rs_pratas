import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { StepUpPurpose } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { forbidden } from "../../core/errors.js";
import { issueStepUpToken, requireStepUp } from "./step-up.service.js";
import {
  confirmTwoFactorSetup,
  startTwoFactorSetup,
  useRecoveryCode,
  verifyTwoFactorChallenge,
} from "./two-factor.service.js";

const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "O código tem 6 números."),
});

export async function twoFactorRoutes(app: FastifyInstance) {
  app.post("/2fa/setup", { preHandler: app.requireAuth }, async (request) => {
    return startTwoFactorSetup(request);
  });

  app.post("/2fa/confirm", { preHandler: app.requireAuth }, async (request) => {
    const { code } = totpCodeSchema.parse(request.body);
    return confirmTwoFactorSetup({ code, request });
  });

  app.post("/2fa/verify", { preHandler: app.requireAuth }, async (request) => {
    const { code } = totpCodeSchema.parse(request.body);
    return verifyTwoFactorChallenge({ code, request });
  });

  app.post("/2fa/recovery-code", { preHandler: app.requireAuth }, async (request) => {
    const { code } = z.object({ code: z.string().min(4).max(40) }).parse(request.body);
    return useRecoveryCode({ code, request });
  });

  /**
   * Desligar o 2FA é justamente a ação que um invasor com sessão aberta faria
   * primeiro — por isso exige reautenticação com o próprio segundo fator.
   */
  app.post(
    "/2fa/disable",
    {
      preHandler: [app.requireAuth, requireStepUp(StepUpPurpose.TWO_FACTOR_DISABLE)],
    },
    async (request, reply) => {
      if (request.user.role === "DONO") {
        throw forbidden(
          "TWO_FACTOR_MANDATORY",
          "A verificação em duas etapas é obrigatória para o perfil Dono e não pode ser desativada.",
        );
      }

      await prisma.twoFactorCredential.deleteMany({ where: { userId: request.user.sub } });

      await audit(request, {
        action: "TWO_FACTOR_DISABLE",
        result: "SUCCESS",
        userId: request.user.sub,
        companyId: request.user.companyId,
        userRoleSnapshot: request.user.role,
      });

      return reply.status(204).send();
    },
  );

  app.post("/step-up", { preHandler: app.requireAuth }, async (request) => {
    const input = z
      .object({
        purpose: z.nativeEnum(StepUpPurpose),
        password: z.string().max(128).optional(),
        totpCode: z.string().regex(/^\d{6}$/).optional(),
      })
      .parse(request.body);

    return issueStepUpToken({
      purpose: input.purpose,
      request,
      ...(input.password ? { password: input.password } : {}),
      ...(input.totpCode ? { totpCode: input.totpCode } : {}),
    });
  });
}
