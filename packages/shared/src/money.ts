import { z } from "zod";

/**
 * Marca um campo Zod como monetário. A marcação vive num WeakSet (não no
 * `.brand()` do zod, que é só um fantasma de tipo em compile-time) para que
 * `collectMoneyPaths` consiga identificar o campo em runtime e o hook de
 * mascaramento (`money-mask.hook.ts`, apps/api) saiba o que ocultar para o
 * perfil DESENVOLVEDOR.
 */
const moneySchemas = new WeakSet<z.ZodTypeAny>();

export function money(): z.ZodNumber {
  const schema = z.number().finite();
  moneySchemas.add(schema);
  return schema;
}

export function isMoneySchema(schema: z.ZodTypeAny): boolean {
  return moneySchemas.has(schema);
}

/**
 * Percorre um schema Zod de resposta e retorna os JSON pointers (`/a/b`,
 * `/items/*\/cost`) de todo campo criado com `money()`. Roda uma vez no boot
 * da rota (não por request) — o resultado alimenta `routeOptions.config.moneyPaths`.
 */
export function collectMoneyPaths(schema: z.ZodTypeAny, path = ""): string[] {
  const unwrapped = unwrap(schema);

  if (isMoneySchema(unwrapped)) {
    return [path || "/"];
  }

  if (unwrapped instanceof z.ZodObject) {
    const shape = unwrapped.shape as Record<string, z.ZodTypeAny>;
    return Object.entries(shape).flatMap(([key, value]) =>
      collectMoneyPaths(value, `${path}/${key}`),
    );
  }

  if (unwrapped instanceof z.ZodArray) {
    return collectMoneyPaths(unwrapped.element, `${path}/*`);
  }

  if (unwrapped instanceof z.ZodRecord) {
    return collectMoneyPaths(unwrapped.valueSchema, `${path}/*`);
  }

  if (unwrapped instanceof z.ZodUnion || unwrapped instanceof z.ZodDiscriminatedUnion) {
    const options = Array.from(unwrapped.options.values()) as z.ZodTypeAny[];
    return options.flatMap((option) => collectMoneyPaths(option, path));
  }

  return [];
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return unwrap(schema._def.innerType as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodEffects) {
    return unwrap(schema._def.schema as z.ZodTypeAny);
  }
  return schema;
}
