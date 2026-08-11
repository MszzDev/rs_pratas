import { describe, expect, it } from "vitest";
import { loginPinSchema, passwordSchema, pinSchema } from "./auth.schema.js";
import { DEFAULT_ROLE_PERMISSIONS } from "../role-permissions.const.js";
import { PERMISSION_CODES } from "../permissions.const.js";

describe("política de senha", () => {
  it("exige no mínimo 12 caracteres", () => {
    expect(passwordSchema.safeParse("curta123").success).toBe(false);
    expect(passwordSchema.safeParse("senha-com-doze").success).toBe(true);
  });

  it("recusa senha absurdamente longa", () => {
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });
});

describe("formato do PIN", () => {
  it("aceita apenas 4 ou 6 dígitos", () => {
    expect(pinSchema.safeParse("4821").success).toBe(true);
    expect(pinSchema.safeParse("482103").success).toBe(true);

    expect(pinSchema.safeParse("482").success).toBe(false);
    expect(pinSchema.safeParse("48210").success).toBe(false);
    expect(pinSchema.safeParse("4821034").success).toBe(false);
  });

  it("recusa letras", () => {
    expect(pinSchema.safeParse("48a1").success).toBe(false);
  });
});

describe("login por PIN", () => {
  it("exige dispositivo — PIN sozinho nunca é credencial suficiente", () => {
    const semDispositivo = loginPinSchema.safeParse({ employeeCode: "RS000001", pin: "4821" });
    expect(semDispositivo.success).toBe(false);

    const completo = loginPinSchema.safeParse({
      deviceId: crypto.randomUUID(),
      employeeCode: "RS000001",
      pin: "4821",
    });
    expect(completo.success).toBe(true);
  });
});

describe("permissões padrão por perfil", () => {
  it("DONO recebe o catálogo completo", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.DONO).toHaveLength(PERMISSION_CODES.length);
  });

  it("DESENVOLVEDOR só recebe permissões de visualização", () => {
    for (const code of DEFAULT_ROLE_PERMISSIONS.DESENVOLVEDOR) {
      expect(code, `${code} não é uma permissão de visualização`).toContain("VIEW");
    }
  });

  it("VENDEDOR não recebe permissões administrativas", () => {
    for (const code of ["USER_CREATE", "STORE_CREATE", "PRODUCT_VIEW_COST", "AUDIT_VIEW_ALL"]) {
      expect(DEFAULT_ROLE_PERMISSIONS.VENDEDOR).not.toContain(code);
    }
  });

  it("GERENTE herda tudo do vendedor", () => {
    for (const code of DEFAULT_ROLE_PERMISSIONS.VENDEDOR) {
      expect(DEFAULT_ROLE_PERMISSIONS.GERENTE).toContain(code);
    }
  });

  it("GERENTE não cria usuários nem lojas — regra explícita da especificação", () => {
    for (const code of ["USER_CREATE", "USER_PROMOTE_OWNER", "STORE_CREATE"]) {
      expect(DEFAULT_ROLE_PERMISSIONS.GERENTE).not.toContain(code);
    }
  });
});
