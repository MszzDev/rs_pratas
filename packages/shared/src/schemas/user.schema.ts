import { z } from "zod";
import { USER_ROLES } from "../roles.const.js";

export const createUserSchema = z.object({
  name: z.string().min(2, "Informe o nome completo.").max(120),
  email: z.string().email("Informe um e-mail válido.").max(255),
  role: z.enum(USER_ROLES),
  /** Lojas às quais o funcionário terá acesso. Dono e desenvolvedor veem todas. */
  storeIds: z.array(z.string().uuid()).default([]),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  email: z.string().email().max(255).optional(),
  storeIds: z.array(z.string().uuid()).optional(),
});

export const changeUserRoleSchema = z.object({
  role: z.enum(USER_ROLES),
  reason: z.string().min(3, "Informe o motivo da alteração.").max(500),
});

export const blockUserSchema = z.object({
  reason: z.string().min(3, "Informe o motivo do bloqueio.").max(500),
});

export const userSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  employeeCode: z.string(),
  role: z.enum(USER_ROLES),
  status: z.string(),
  storeIds: z.array(z.string().uuid()),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export const createStoreSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(120),
  cnpj: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  timezone: z.string().max(60).default("America/Sao_Paulo"),
});

export const updateStoreSchema = createStoreSchema.partial();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangeUserRoleInput = z.infer<typeof changeUserRoleSchema>;
export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
