import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collectMoneyPaths, isMoneySchema, money } from "./money.js";

describe("marcação de campo monetário", () => {
  it("reconhece um schema criado com money()", () => {
    const schema = money();
    expect(isMoneySchema(schema)).toBe(true);
    expect(isMoneySchema(z.number())).toBe(false);
  });

  it("continua sendo um número válido do zod", () => {
    expect(money().safeParse(189.9).success).toBe(true);
    expect(money().safeParse("189,90").success).toBe(false);
    expect(money().safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });
});

describe("collectMoneyPaths", () => {
  it("encontra campos monetários no primeiro nível", () => {
    const schema = z.object({ id: z.string(), price: money() });
    expect(collectMoneyPaths(schema)).toEqual(["/price"]);
  });

  it("percorre objetos aninhados", () => {
    const schema = z.object({
      sale: z.object({ total: money(), customer: z.string() }),
    });
    expect(collectMoneyPaths(schema)).toEqual(["/sale/total"]);
  });

  it("marca arrays com curinga", () => {
    const schema = z.object({
      items: z.array(z.object({ sku: z.string(), cost: money() })),
    });
    expect(collectMoneyPaths(schema)).toEqual(["/items/*/cost"]);
  });

  it("enxerga através de optional e nullable", () => {
    const schema = z.object({
      discount: money().optional(),
      margin: money().nullable(),
    });
    expect(collectMoneyPaths(schema).sort()).toEqual(["/discount", "/margin"]);
  });

  it("devolve lista vazia quando não há campo monetário", () => {
    const schema = z.object({ id: z.string(), quantity: z.number() });
    expect(collectMoneyPaths(schema)).toEqual([]);
  });
});
