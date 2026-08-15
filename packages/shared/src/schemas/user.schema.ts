import { z } from "zod";
import { USER_ROLES } from "../roles.const.js";

/**
 * A identidade do funcionário é a matrícula, gerada pelo sistema. O e-mail é
 * opcional e serve só de canal de entrega — credencial do primeiro acesso,
 * aviso de documento conferido. Ninguém entra no sistema com ele, e não existe
 * link de recuperação de senha por e-mail.
 */
export const createUserSchema = z.object({
  name: z.string().min(2, "Informe o nome completo.").max(120),
  role: z.enum(USER_ROLES),
  email: z.string().email("Informe um e-mail válido.").max(160).optional(),
  /** Lojas às quais o funcionário terá acesso. Dono e desenvolvedor veem todas. */
  storeIds: z.array(z.string().uuid()).default([]),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  /** String vazia apaga o e-mail cadastrado. */
  email: z.union([z.string().email().max(160), z.literal("")]).optional(),
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
  employeeCode: z.string(),
  email: z.string().nullable(),
  role: z.enum(USER_ROLES),
  status: z.string(),
  storeIds: z.array(z.string().uuid()),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export const grantPermissionSchema = z.object({
  code: z.string().min(1).max(60),
  effect: z.enum(["ALLOW", "DENY"]).default("ALLOW"),
  reason: z.string().min(3, "Informe o motivo da liberação.").max(500),
  /** Opcional: liberação temporária, por exemplo durante um afastamento. */
  expiresAt: z.string().datetime().optional(),
});

export const revokePermissionSchema = z.object({
  reason: z.string().min(3, "Informe o motivo da revogação.").max(500),
});

/**
 * Endereço da loja.
 *
 * Guardado como JSON e não em colunas soltas: o endereço aparece inteiro no
 * comprovante e na etiqueta, nunca é filtrado por campo, e um bloco JSON
 * evita seis colunas que só existem para serem lidas juntas.
 */
export const storeAddressSchema = z.object({
  cep: z.string().max(10).optional(),
  logradouro: z.string().max(160).optional(),
  numero: z.string().max(20).optional(),
  complemento: z.string().max(80).optional(),
  bairro: z.string().max(80).optional(),
  cidade: z.string().max(80).optional(),
  uf: z.string().max(2).optional(),
});

export const createStoreSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(2).max(120),
  cnpj: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(160).optional(),
  timezone: z.string().max(60).default("America/Sao_Paulo"),
  address: storeAddressSchema.optional(),
});

export const updateStoreSchema = createStoreSchema.partial();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangeUserRoleInput = z.infer<typeof changeUserRoleSchema>;
export type StoreAddress = z.infer<typeof storeAddressSchema>;
export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
