import { z } from "zod";
import { USER_ROLES } from "../roles.const.js";

/**
 * Política de senha. Mínimo de 12 caracteres em vez dos 8 tradicionais: este é
 * um sistema com acesso a caixa, custo e permissões, e comprimento protege
 * muito mais que regras de composição (recomendação NIST SP 800-63B).
 */
export const passwordSchema = z
  .string()
  .min(12, "A senha deve ter ao menos 12 caracteres.")
  .max(128, "A senha deve ter no máximo 128 caracteres.");

/** PIN de 4 ou 6 dígitos, só números — teclado numérico do tablet. */
export const pinSchema = z
  .string()
  .regex(/^\d{4}$|^\d{6}$/, "O PIN deve ter 4 ou 6 números.");

/** E-mail ou matrícula — a API aceita os dois no mesmo campo. */
export const identifierSchema = z
  .string()
  .min(1, "Informe seu e-mail ou matrícula.")
  .max(255);

export const loginPasswordSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1, "Informe sua senha.").max(128),
  /** Opcional: só é enviado quando o login parte de um tablet pareado. */
  deviceId: z.string().uuid().optional(),
});

export const loginPinSchema = z.object({
  deviceId: z.string().uuid("Dispositivo inválido."),
  employeeCode: z.string().min(1, "Informe sua matrícula.").max(50),
  pin: pinSchema,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const authenticatedUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  employeeCode: z.string(),
  role: z.enum(USER_ROLES),
  companyId: z.string().uuid(),
  storeIds: z.array(z.string().uuid()),
  mustChangePassword: z.boolean(),
  mustCreatePin: z.boolean(),
  /** Perfil exige 2FA e ele ainda não foi confirmado. */
  twoFactorPending: z.boolean(),
});

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  user: authenticatedUserSchema,
});

export const sessionSummarySchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid().nullable(),
  deviceName: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
  current: z.boolean(),
});

export type LoginPasswordInput = z.infer<typeof loginPasswordSchema>;
export type LoginPinInput = z.infer<typeof loginPinSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
