import { z } from "zod";

export const DEVICE_TYPES = ["TABLET", "DESKTOP", "MOBILE"] as const;
export const DEVICE_STATUSES = ["PENDING", "ACTIVE", "BLOCKED", "UNLINKED", "RETIRED"] as const;

export const createPOSStationSchema = z.object({
  storeId: z.string().uuid(),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
});

export const createCashRegisterSchema = z.object({
  posStationId: z.string().uuid(),
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
});

export const createDeviceSchema = z.object({
  cashRegisterId: z.string().uuid(),
  name: z.string().min(1).max(120),
  type: z.enum(DEVICE_TYPES).default("TABLET"),
});

/**
 * O tablet envia o código exibido pelo gerente junto da sua identidade de
 * hardware. Só nesse momento o Device sai de PENDING e ganha um deviceUuid.
 */
export const claimDeviceSchema = z.object({
  pairingCode: z.string().min(6).max(12),
  deviceUuid: z.string().min(8).max(200),
  model: z.string().max(120).optional(),
  osVersion: z.string().max(60).optional(),
  appVersion: z.string().max(60).optional(),
});

export const deviceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(DEVICE_TYPES),
  status: z.enum(DEVICE_STATUSES),
  storeId: z.string().uuid(),
  cashRegisterId: z.string().uuid(),
  model: z.string().nullable(),
  osVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  isKioskEnabled: z.boolean(),
});

export type CreatePOSStationInput = z.infer<typeof createPOSStationSchema>;
export type CreateCashRegisterInput = z.infer<typeof createCashRegisterSchema>;
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type ClaimDeviceInput = z.infer<typeof claimDeviceSchema>;
export type DeviceSummary = z.infer<typeof deviceSummarySchema>;
