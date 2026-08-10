import { describe, expect, it } from "vitest";
import { isMoneyField, maskMoneyDeep } from "../../src/core/security/money-mask.js";

describe("isMoneyField", () => {
  it("reconhece campos monetários em inglês e português", () => {
    for (const field of [
      "price",
      "cost",
      "salePrice",
      "unitCost",
      "margin",
      "totalAmount",
      "commission",
      "valor",
      "precoVenda",
      "custoMedio",
      "margemLucro",
      "faturamento",
      "ticketMedio",
      "troco",
    ]) {
      expect(isMoneyField(field), field).toBe(true);
    }
  });

  it("não mascara contadores que apenas parecem monetários", () => {
    for (const field of ["totalItems", "totalItens", "totalCount", "totalPages"]) {
      expect(isMoneyField(field), field).toBe(false);
    }
  });

  it("ignora campos claramente não monetários", () => {
    for (const field of ["id", "name", "createdAt", "status", "employeeCode"]) {
      expect(isMoneyField(field), field).toBe(false);
    }
  });
});

describe("maskMoneyDeep", () => {
  it("mascara valores monetários e marca o objeto", () => {
    const masked = maskMoneyDeep({ id: "abc", name: "Anel", price: 189.9 }) as Record<string, unknown>;

    expect(masked.price).toBeNull();
    expect(masked._masked).toBe(true);
    expect(masked.name).toBe("Anel");
    expect(masked.id).toBe("abc");
  });

  it("percorre objetos aninhados e arrays", () => {
    const masked = maskMoneyDeep({
      sale: {
        total: 700,
        items: [
          { sku: "A1", price: 200 },
          { sku: "A2", price: 500 },
        ],
      },
    }) as { sale: { total: unknown; items: Array<Record<string, unknown>> } };

    expect(masked.sale.total).toBeNull();
    expect(masked.sale.items[0]!.price).toBeNull();
    expect(masked.sale.items[1]!.price).toBeNull();
    expect(masked.sale.items[0]!.sku).toBe("A1");
  });

  it("mascara valor monetário enviado como texto", () => {
    const masked = maskMoneyDeep({ valor: "1.299,00" }) as Record<string, unknown>;
    expect(masked.valor).toBeNull();
  });

  it("não marca objetos que não tinham nada a esconder", () => {
    const masked = maskMoneyDeep({ id: "abc", name: "Loja" }) as Record<string, unknown>;
    expect(masked._masked).toBeUndefined();
  });

  it("preserva null e tipos primitivos", () => {
    expect(maskMoneyDeep(null)).toBeNull();
    expect(maskMoneyDeep("texto")).toBe("texto");
    expect(maskMoneyDeep(42)).toBe(42);
  });
});
