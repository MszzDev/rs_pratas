import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/prisma.js";
import { audit } from "../../core/audit.service.js";
import { badRequest, notFound } from "../../core/errors.js";
import { assertStoreAccess, requireRole } from "../../core/rbac/require-role.hook.js";
import { requirePermission } from "../../core/rbac/require-permission.hook.js";
import { env } from "../../config/env.js";
import { emailConfigurado, sendEmail } from "../../core/email/index.js";

const settingBodySchema = z.object({
  key: z.string().min(1).max(120),
  value: z.unknown(),
  description: z.string().max(500).optional(),
});

/**
 * Configurações em três níveis, do mais amplo ao mais específico: empresa, loja
 * e dispositivo. O tablet lê a configuração efetiva combinando os três, com o
 * nível mais específico prevalecendo — assim uma loja pode ter tempo de
 * bloqueio por inatividade diferente do padrão da empresa, e um tablet
 * específico pode diferir da sua loja.
 */
export async function settingsRoutes(app: FastifyInstance) {
  const ownerOnly = [app.requireAuth, requireRole("DONO")];

  app.get(
    "/settings/app",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_APP")] },
    async (request) => {
      return prisma.appSetting.findMany({
        where: { companyId: request.user.companyId },
        orderBy: { key: "asc" },
      });
    },
  );

  /**
   * O punhado de configurações que o TABLET precisa conhecer.
   *
   * A lista completa é do dono; esta é aberta a qualquer sessão porque quem
   * precisa dela é a vendedora no balcão — o bloqueio por inatividade só
   * funciona se a tela dela souber depois de quantos segundos travar.
   *
   * Só sai daqui o que não é sensível: um número de segundos e um texto de
   * rodapé não dizem nada sobre a empresa que já não esteja impresso no
   * comprovante.
   */
  app.get("/settings/device-policy", { preHandler: app.requireAuth }, async (request) => {
    const settings = await prisma.appSetting.findMany({
      where: {
        companyId: request.user.companyId,
        key: { in: ["inactivity_lock_seconds", "receipt_footer"] },
      },
    });

    const valor = (chave: string) => settings.find((setting) => setting.key === chave)?.value;
    const segundos = Number(valor("inactivity_lock_seconds") ?? 0);

    return {
      // Zero ou ausente: sem bloqueio. Só trava onde alguém decidiu que trava.
      inactivityLockSeconds: Number.isFinite(segundos) && segundos > 0 ? segundos : 0,
      receiptFooter: typeof valor("receipt_footer") === "string" ? valor("receipt_footer") : null,
    };
  });

  /**
   * O e-mail está ligado?
   *
   * Sem SMTP configurado o sistema não envia nada — e faz isso em silêncio, de
   * propósito: uma falha de envio nunca derruba o cadastro que já deu certo.
   * O efeito colateral é que ninguém descobre que o e-mail está desligado até
   * um cliente reclamar que não recebeu o comprovante. Esta rota existe para a
   * tela poder dizer.
   */
  app.get("/settings/email", { preHandler: ownerOnly }, async () => {
    return {
      ligado: emailConfigurado(),
      remetente: env.MAIL_FROM,
      // O endereço do servidor SEM a senha: o suficiente para conferir que é o
      // provedor certo, sem devolver credencial para a tela.
      servidor: env.SMTP_URL
        ? env.SMTP_URL.replace(/\/\/[^@]*@/, "//")
        : env.SMTP_HOST
          ? `${env.SMTP_HOST}:${env.SMTP_PORT}`
          : null,
    };
  });

  /**
   * Manda um e-mail de teste para quem pediu.
   *
   * Para o próprio endereço do dono, e não para um digitado na hora: assim o
   * teste não vira um jeito de mandar mensagem em nome da loja para qualquer
   * um.
   */
  app.post("/settings/email/test", { preHandler: ownerOnly }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.user.sub },
      select: { email: true, name: true },
    });

    /**
     * Para onde vai o teste.
     *
     * O padrão continua sendo o e-mail de quem clicou — é o destino que não
     * precisa de confirmação de ninguém. Mas poder escolher importa para a
     * pergunta que realmente se faz aqui: "chega, ou cai no spam?". A resposta
     * muda conforme o provedor de quem recebe, e a caixa do dono é uma só.
     *
     * Continua sendo rota de dono, e o texto é fixo — não há como usar isto
     * para mandar mensagem escrita por alguém a um endereço qualquer.
     */
    const { para } = z
      .object({ para: z.string().email("Endereço inválido.").optional() })
      .parse(request.body ?? {});

    const destino = para ?? user.email;

    if (!destino) {
      throw badRequest(
        "NO_EMAIL",
        "Sua conta não tem e-mail cadastrado. Escreva um endereço no campo ou coloque um em Funcionários.",
      );
    }

    if (!emailConfigurado()) {
      throw badRequest(
        "EMAIL_OFF",
        "O envio de e-mail ainda não está configurado. Preencha SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD e MAIL_FROM no painel do Render.",
      );
    }

    const enviado = await sendEmail({
      to: destino,
      subject: "Teste de envio — RS Pratas",
      text: [
        `Olá, ${user.name.split(" ")[0]}.`,
        "",
        "Se você está lendo isto, o envio de e-mail do sistema está funcionando:",
        "comprovante de venda, garantia e credencial de funcionário vão chegar.",
        "",
        "Nada mais precisa ser feito.",
      ].join("\n"),
    });

    if (!enviado) {
      throw badRequest(
        "EMAIL_FAILED",
        "O provedor recusou o envio. Confira SMTP_URL e se o remetente (MAIL_FROM) pertence ao domínio autorizado.",
      );
    }

    return { enviado: true, para: destino };
  });

  app.put("/settings/app", { preHandler: ownerOnly }, async (request) => {
    const input = settingBodySchema.parse(request.body);

    const previous = await prisma.appSetting.findUnique({
      where: { companyId_key: { companyId: request.user.companyId, key: input.key } },
    });

    const setting = await prisma.appSetting.upsert({
      where: { companyId_key: { companyId: request.user.companyId, key: input.key } },
      update: {
        value: input.value as never,
        description: input.description ?? null,
        updatedById: request.user.sub,
      },
      create: {
        companyId: request.user.companyId,
        key: input.key,
        value: input.value as never,
        description: input.description ?? null,
        updatedById: request.user.sub,
      },
    });

    await audit(request, {
      action: "SETTING_UPDATE",
      result: "SUCCESS",
      userId: request.user.sub,
      companyId: request.user.companyId,
      userRoleSnapshot: request.user.role,
      entityType: "AppSetting",
      entityId: setting.id,
      ...(previous ? { previousData: { key: previous.key, value: previous.value as never } } : {}),
      newData: { key: setting.key, value: setting.value as never },
    });

    return setting;
  });

  app.get("/settings/stores/:storeId", { preHandler: app.requireAuth }, async (request) => {
    const { storeId } = z.object({ storeId: z.string().uuid() }).parse(request.params);
    await assertStoreAccess(request, storeId);

    return prisma.storeSetting.findMany({ where: { storeId }, orderBy: { key: "asc" } });
  });

  app.put(
    "/settings/stores/:storeId",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_STORE")] },
    async (request) => {
      const { storeId } = z.object({ storeId: z.string().uuid() }).parse(request.params);
      const input = settingBodySchema.parse(request.body);
      await assertStoreAccess(request, storeId);

      const setting = await prisma.storeSetting.upsert({
        where: { storeId_key: { storeId, key: input.key } },
        update: { value: input.value as never, updatedById: request.user.sub },
        create: {
          storeId,
          key: input.key,
          value: input.value as never,
          updatedById: request.user.sub,
        },
      });

      await audit(request, {
        action: "SETTING_UPDATE",
        result: "SUCCESS",
        userId: request.user.sub,
        companyId: request.user.companyId,
        storeId,
        userRoleSnapshot: request.user.role,
        entityType: "StoreSetting",
        entityId: setting.id,
        newData: { key: setting.key, value: setting.value as never },
      });

      return setting;
    },
  );

  app.get("/settings/devices/:deviceId", { preHandler: app.requireAuth }, async (request) => {
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);

    const device = await prisma.device.findFirst({
      where: { id: deviceId, companyId: request.user.companyId, deletedAt: null },
      select: { storeId: true },
    });
    if (!device) {
      throw notFound("DEVICE_NOT_FOUND", "Dispositivo não encontrado.");
    }
    await assertStoreAccess(request, device.storeId);

    return prisma.deviceSetting.findMany({ where: { deviceId }, orderBy: { key: "asc" } });
  });

  app.put(
    "/settings/devices/:deviceId",
    { preHandler: [app.requireAuth, requirePermission("SETTINGS_MANAGE_DEVICE")] },
    async (request) => {
      const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);
      const input = settingBodySchema.parse(request.body);

      const device = await prisma.device.findFirst({
        where: { id: deviceId, companyId: request.user.companyId, deletedAt: null },
        select: { storeId: true },
      });
      if (!device) {
        throw notFound("DEVICE_NOT_FOUND", "Dispositivo não encontrado.");
      }
      await assertStoreAccess(request, device.storeId);

      const setting = await prisma.deviceSetting.upsert({
        where: { deviceId_key: { deviceId, key: input.key } },
        update: { value: input.value as never, updatedById: request.user.sub },
        create: {
          deviceId,
          key: input.key,
          value: input.value as never,
          updatedById: request.user.sub,
        },
      });

      await audit(request, {
        action: "SETTING_UPDATE",
        result: "SUCCESS",
        userId: request.user.sub,
        companyId: request.user.companyId,
        storeId: device.storeId,
        deviceId,
        userRoleSnapshot: request.user.role,
        entityType: "DeviceSetting",
        entityId: setting.id,
        newData: { key: setting.key, value: setting.value as never },
      });

      return setting;
    },
  );
}
