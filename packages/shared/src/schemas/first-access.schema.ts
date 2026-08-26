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

/**
 * PIN previsível — a mesma regra dos dois lados.
 *
 * Vive aqui, e não só no servidor, porque o servidor recusar é tarde demais.
 * O primeiro acesso gravava a senha nova ANTES de pedir o PIN; quando o PIN
 * era recusado, a pessoa ficava com a senha do papel já invalidada e o cadastro
 * pela metade — e a tela continuava pedindo "a senha temporária", que já não
 * existia. Foi assim que o dono ficou trancado para fora do próprio sistema.
 *
 * O fluxo virou atômico e isso não pode mais acontecer. Mas a validação ficou
 * aqui de qualquer forma: recusar "1234" enquanto a pessoa digita é melhor que
 * recusar depois de ela apertar o botão.
 */
export function isWeakPin(pin: string): boolean {
  if (!/^\d{4}$|^\d{6}$/.test(pin)) return false;

  // 1111, 000000: um dígito só, repetido.
  if (/^(\d)\1+$/.test(pin)) return true;

  const digitos = pin.split("").map(Number) as number[];
  const crescente = digitos.every((d, i) => i === 0 || d === digitos[i - 1]! + 1);
  const decrescente = digitos.every((d, i) => i === 0 || d === digitos[i - 1]! - 1);

  return crescente || decrescente;
}

/**
 * O primeiro acesso inteiro, numa chamada só.
 *
 * Substitui os passos separados de senha e PIN. Eles gravavam cada um por si,
 * então uma falha no segundo deixava a conta num estado impossível: senha do
 * papel já trocada, cadastro incompleto, e nenhuma tela capaz de explicar
 * isso a quem estava do outro lado.
 *
 * Aqui ou tudo entra, ou nada entra.
 */
export const firstAccessFinishSchema = z
  .object({
    onboardingToken: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
    pin: pinSchema,
    confirmPin: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "As senhas não conferem.",
    path: ["confirmPassword"],
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: "Os PINs não conferem.",
    path: ["confirmPin"],
  })
  .refine((data) => !isWeakPin(data.pin), {
    message: "Escolha um PIN menos previsível — evite números repetidos ou em sequência.",
    path: ["pin"],
  });

export type FirstAccessFinishInput = z.infer<typeof firstAccessFinishSchema>;
