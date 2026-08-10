import { z } from "zod";
import { identifierSchema, passwordSchema, pinSchema } from "./auth.schema.js";

export const firstAccessStartSchema = z.object({
  identifier: identifierSchema,
  tempPassword: z.string().min(1, "Informe a senha temporária.").max(128),
});

export const firstAccessSetPasswordSchema = z
  .object({
    onboardingToken: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "As senhas não conferem.",
    path: ["confirmPassword"],
  });

export const firstAccessSetPinSchema = z
  .object({
    onboardingToken: z.string().min(1),
    pin: pinSchema,
    confirmPin: z.string(),
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: "Os PINs não conferem.",
    path: ["confirmPin"],
  });

export const firstAccessCompleteSchema = z.object({
  onboardingToken: z.string().min(1),
  deviceId: z.string().uuid().optional(),
});

export type FirstAccessStartInput = z.infer<typeof firstAccessStartSchema>;
export type FirstAccessSetPasswordInput = z.infer<typeof firstAccessSetPasswordSchema>;
export type FirstAccessSetPinInput = z.infer<typeof firstAccessSetPinSchema>;
export type FirstAccessCompleteInput = z.infer<typeof firstAccessCompleteSchema>;
