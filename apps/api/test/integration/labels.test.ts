import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import {
  createTestApp,
  createTestCompany,
  createTestStore,
  createTestUser,
  disconnectAll,
  resetDatabase,
} from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectAll();
});

beforeEach(async () => {
  await resetDatabase();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function authenticate(employeeCode: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login/password",
    payload: { identifier: employeeCode, password },
  });
  return response.json().accessToken as string;
}

async function scenario() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);
  const { user: owner, password } = await createTestUser({ companyId: company.id, role: "DONO" });
  const token = await authenticate(owner.employeeCode, password);

  const product = (
    await app.inject({
      method: "POST",
      url: "/api/v1/products",
      headers: auth(token),
      payload: {
        sku: "AN-001",
        name: "Anel Solitário de Prata 925 com Zircônia Grande",
        costPrice: 40,
        salePrice: 129.9,
        weightGrams: 3.25,
      },
    })
  ).json();

  const template = (
    await app.inject({
      method: "POST",
      url: "/api/v1/label-templates",
      headers: auth(token),
      payload: {
        code: "JOIA",
        name: "Etiqueta de joia",
        widthMm: 50,
        heightMm: 12,
        isDefault: true,
      },
    })
  ).json();

  return { company, store, token, product, template };
}

describe("modelos de etiqueta", () => {
  it("só existe um modelo padrão por empresa", async () => {
    const { token } = await scenario();

    await app.inject({
      method: "POST",
      url: "/api/v1/label-templates",
      headers: auth(token),
      payload: {
        code: "PINGENTE",
        name: "Etiqueta de pingente",
        widthMm: 30,
        heightMm: 10,
        isDefault: true,
      },
    });

    const defaults = await prisma.labelTemplate.findMany({ where: { isDefault: true } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.code).toBe("PINGENTE");
  });

  it("recusa código repetido", async () => {
    const { token } = await scenario();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/label-templates",
      headers: auth(token),
      payload: { code: "JOIA", name: "Outra", widthMm: 20, heightMm: 10 },
    });

    expect(response.statusCode).toBe(409);
  });

  it("calibração recusa deslocamento maior que a própria etiqueta", async () => {
    const { token, template } = await scenario();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/label-templates/${template.id}/calibration`,
      headers: auth(token),
      payload: { offsetXMm: 200, offsetYMm: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("OFFSET_TOO_LARGE");
  });

  it("calibração dentro do limite é aceita e auditada", async () => {
    const { company, token, template } = await scenario();

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/label-templates/${template.id}/calibration`,
      headers: auth(token),
      payload: { offsetXMm: 1.5, offsetYMm: -0.5 },
    });

    expect(response.statusCode).toBe(200);
    expect(Number(response.json().offsetXMm)).toBe(1.5);

    const entry = await prisma.auditLog.findFirst({
      where: { companyId: company.id, action: "LABEL_TEMPLATE_UPDATE" },
    });
    expect(entry?.reason).toBe("calibração da impressora");
  });

  it("o vendedor não cria modelo de etiqueta", async () => {
    const company = await createTestCompany();
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    const token = await authenticate(seller.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/label-templates",
      headers: auth(token),
      payload: { code: "X", name: "Modelo", widthMm: 20, heightMm: 10 },
    });

    expect(response.statusCode).toBe(403);
  });
});

/**
 * O desenho da etiqueta.
 *
 * O que importa provar aqui é que o desenho fica guardado, que quem não manda
 * no modelo não mexe nele, e — o principal — que uma etiqueta já enfileirada
 * não muda de forma porque alguém abriu o editor no meio do expediente.
 */
describe("desenho da etiqueta", () => {
  const desenho = [
    {
      id: "preco",
      campo: "PRECO" as const,
      xMm: 2,
      yMm: 6,
      larguraMm: 20,
      tamanhoMm: 3,
      negrito: true,
      alinhamento: "right" as const,
    },
  ];

  it("guarda o desenho e registra quem mexeu", async () => {
    const { company, token, template } = await scenario();

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/label-templates/${template.id}/elements`,
      headers: auth(token),
      payload: { elements: desenho },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().elements).toEqual(desenho);

    const entry = await prisma.auditLog.findFirst({
      where: { companyId: company.id, action: "SETTING_UPDATE", entityId: template.id },
    });
    expect(entry).not.toBeNull();
  });

  it("substitui a lista inteira em vez de mesclar", async () => {
    const { token, template } = await scenario();

    await app.inject({
      method: "PUT",
      url: `/api/v1/label-templates/${template.id}/elements`,
      headers: auth(token),
      payload: { elements: [...desenho, { ...desenho[0], id: "sobra" }] },
    });

    // O dono apagou um elemento no editor. Se a gravação mesclasse, ele
    // voltaria sozinho na próxima vez que alguém salvasse.
    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/label-templates/${template.id}/elements`,
      headers: auth(token),
      payload: { elements: desenho },
    });

    expect(response.json().elements).toHaveLength(1);
  });

  it("recusa um desenho maior do que cabe numa etiqueta", async () => {
    const { token, template } = await scenario();

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/label-templates/${template.id}/elements`,
      headers: auth(token),
      payload: {
        elements: Array.from({ length: 31 }, (_, indice) => ({
          ...desenho[0],
          id: `e${indice}`,
        })),
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("o vendedor não redesenha a etiqueta da empresa", async () => {
    const { company, template } = await scenario();
    const { user: seller, password } = await createTestUser({
      companyId: company.id,
      role: "VENDEDOR",
    });
    const token = await authenticate(seller.employeeCode, password);

    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/label-templates/${template.id}/elements`,
      headers: auth(token),
      payload: { elements: desenho },
    });

    expect(response.statusCode).toBe(403);
  });

  /**
   * O defeito que isto tranca: o dono posicionava o preço no editor, via na
   * prévia, salvava — e a etiqueta saía sem preço, porque um interruptor
   * escolhido na criação do modelo dizia "não mostrar preço". Sem erro em
   * lugar nenhum, e o rolo já impresso.
   */
  async function modeloSemPreco(token: string) {
    return (
      await app.inject({
        method: "POST",
        url: "/api/v1/label-templates",
        headers: auth(token),
        payload: {
          code: "SEMPRECO",
          name: "Sem preço",
          widthMm: 50,
          heightMm: 30,
          showPrice: false,
        },
      })
    ).json();
  }

  it("com desenho, o interruptor de esconder não apaga mais o dado", async () => {
    const { store, token, product } = await scenario();
    const modelo = await modeloSemPreco(token);

    // O desenho tem um elemento de preço, e é ele que decide.
    await app.inject({
      method: "PUT",
      url: `/api/v1/label-templates/${modelo.id}/elements`,
      headers: auth(token),
      payload: { elements: desenho },
    });

    const job = (
      await app.inject({
        method: "POST",
        url: "/api/v1/print-jobs/labels",
        headers: auth(token),
        payload: {
          storeId: store.id,
          productId: product.id,
          copies: 1,
          templateId: modelo.id,
        },
      })
    ).json();

    expect(job.payload.price).not.toBeNull();
  });

  it("sem desenho, o interruptor continua mandando", async () => {
    const { store, token, product } = await scenario();
    const modelo = await modeloSemPreco(token);

    const job = (
      await app.inject({
        method: "POST",
        url: "/api/v1/print-jobs/labels",
        headers: auth(token),
        payload: {
          storeId: store.id,
          productId: product.id,
          copies: 1,
          templateId: modelo.id,
        },
      })
    ).json();

    expect(job.payload.price).toBeNull();
  });

  it("o trabalho já na fila leva o desenho de quando foi criado", async () => {
    const { store, token, template, product } = await scenario();

    await app.inject({
      method: "PUT",
      url: `/api/v1/label-templates/${template.id}/elements`,
      headers: auth(token),
      payload: { elements: desenho },
    });

    const job = (
      await app.inject({
        method: "POST",
        url: "/api/v1/print-jobs/labels",
        headers: auth(token),
        payload: { storeId: store.id, productId: product.id, copies: 1 },
      })
    ).json();

    expect(job.payload.layout.elements).toEqual(desenho);

    // O dono muda o desenho enquanto a fila anda. A etiqueta que já esperava
    // não pode sair diferente do que foi pedida.
    await app.inject({
      method: "PUT",
      url: `/api/v1/label-templates/${template.id}/elements`,
      headers: auth(token),
      payload: { elements: [{ ...desenho[0], id: "outro", campo: "SKU" as const }] },
    });

    const fila = (
      await app.inject({
        method: "GET",
        url: `/api/v1/print-jobs/queue?storeId=${store.id}`,
        headers: auth(token),
      })
    ).json();

    expect(fila[0].payload.layout.elements).toEqual(desenho);
  });
});

describe("fila de impressão", () => {
  it("congela o preço no momento do pedido", async () => {
    const { store, token, product } = await scenario();

    const job = (
      await app.inject({
        method: "POST",
        url: "/api/v1/print-jobs/labels",
        headers: auth(token),
        payload: { storeId: store.id, productId: product.id, copies: 3 },
      })
    ).json();

    expect(job.payload.price).toBe("129.90");

    // Preço muda depois — a etiqueta na fila não muda junto.
    await app.inject({
      method: "PATCH",
      url: `/api/v1/products/${product.id}`,
      headers: auth(token),
      payload: { salePrice: 199.9 },
    });

    const stored = await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
    expect((stored.payload as { price: string }).price).toBe("129.90");
  });

  it("corta o nome longo para caber na etiqueta", async () => {
    const { store, token, product } = await scenario();

    const job = (
      await app.inject({
        method: "POST",
        url: "/api/v1/print-jobs/labels",
        headers: auth(token),
        payload: { storeId: store.id, productId: product.id, copies: 1 },
      })
    ).json();

    expect(job.payload.productName.length).toBeLessThanOrEqual(28);
  });

  it("respeita o que o modelo manda esconder", async () => {
    const { store, token, product } = await scenario();

    const semPreco = (
      await app.inject({
        method: "POST",
        url: "/api/v1/label-templates",
        headers: auth(token),
        payload: {
          code: "SEMPRECO",
          name: "Sem preço",
          widthMm: 40,
          heightMm: 10,
          showPrice: false,
          showWeight: true,
        },
      })
    ).json();

    const job = (
      await app.inject({
        method: "POST",
        url: "/api/v1/print-jobs/labels",
        headers: auth(token),
        payload: {
          storeId: store.id,
          productId: product.id,
          copies: 1,
          templateId: semPreco.id,
        },
      })
    ).json();

    expect(job.payload.price).toBeNull();
    expect(job.payload.weightGrams).toBe("3.250");
  });

  it("produto com tamanhos exige dizer qual vai na etiqueta", async () => {
    const { store, token } = await scenario();

    const grade = (
      await app.inject({
        method: "POST",
        url: "/api/v1/size-grades",
        headers: auth(token),
        payload: { code: "ANEL", name: "Grade", sizes: ["16", "18"] },
      })
    ).json();

    const comTamanho = (
      await app.inject({
        method: "POST",
        url: "/api/v1/products",
        headers: auth(token),
        payload: {
          sku: "AN-500",
          name: "Anel",
          costPrice: 10,
          salePrice: 50,
          sizeGradeId: grade.id,
          sizes: ["16", "18"],
        },
      })
    ).json();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/print-jobs/labels",
      headers: auth(token),
      payload: { storeId: store.id, productId: comTamanho.id, copies: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VARIATION_REQUIRED");
  });

  it("sem modelo configurado, avisa em vez de imprimir errado", async () => {
    const company = await createTestCompany();
    const store = await createTestStore(company.id);
    const { user: owner, password } = await createTestUser({
      companyId: company.id,
      role: "DONO",
    });
    const token = await authenticate(owner.employeeCode, password);

    const product = (
      await app.inject({
        method: "POST",
        url: "/api/v1/products",
        headers: auth(token),
        payload: { sku: "X-1", name: "Peça", costPrice: 1, salePrice: 2 },
      })
    ).json();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/print-jobs/labels",
      headers: auth(token),
      payload: { storeId: store.id, productId: product.id, copies: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("NO_TEMPLATE");
  });

  it("falha na impressão não some da fila — fica registrada com o erro", async () => {
    const { store, token, product } = await scenario();

    const job = (
      await app.inject({
        method: "POST",
        url: "/api/v1/print-jobs/labels",
        headers: auth(token),
        payload: { storeId: store.id, productId: product.id, copies: 1 },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/print-jobs/${job.id}/result`,
      headers: auth(token),
      payload: { success: false, error: "acabou o papel" },
    });

    const stored = await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(stored.status).toBe("FALHOU");
    expect(stored.lastError).toBe("acabou o papel");
    expect(stored.attempts).toBe(1);

    // Continua na fila do tablet para ser tentada de novo.
    const queue = (
      await app.inject({
        method: "GET",
        url: `/api/v1/print-jobs/queue?storeId=${store.id}`,
        headers: auth(token),
      })
    ).json();

    expect(queue.map((item: { id: string }) => item.id)).toContain(job.id);
  });

  it("o que já imprimiu sai da fila", async () => {
    const { store, token, product } = await scenario();

    const job = (
      await app.inject({
        method: "POST",
        url: "/api/v1/print-jobs/labels",
        headers: auth(token),
        payload: { storeId: store.id, productId: product.id, copies: 1 },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/print-jobs/${job.id}/result`,
      headers: auth(token),
      payload: { success: true },
    });

    const queue = (
      await app.inject({
        method: "GET",
        url: `/api/v1/print-jobs/queue?storeId=${store.id}`,
        headers: auth(token),
      })
    ).json();

    expect(queue).toHaveLength(0);
  });

  it("não cancela o que já foi impresso", async () => {
    const { store, token, product } = await scenario();

    const job = (
      await app.inject({
        method: "POST",
        url: "/api/v1/print-jobs/labels",
        headers: auth(token),
        payload: { storeId: store.id, productId: product.id, copies: 1 },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/print-jobs/${job.id}/result`,
      headers: auth(token),
      payload: { success: true },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/print-jobs/${job.id}/cancel`,
      headers: auth(token),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ALREADY_PRINTED");
  });

  it("não enfileira etiqueta em loja que o usuário não alcança", async () => {
    const { company, product } = await scenario();
    const outraLoja = await createTestStore(company.id, "LB");

    const { user: manager, password } = await createTestUser({
      companyId: company.id,
      role: "GERENTE",
    });
    const managerToken = await authenticate(manager.employeeCode, password);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/print-jobs/labels",
      headers: auth(managerToken),
      payload: { storeId: outraLoja.id, productId: product.id, copies: 1 },
    });

    expect(response.statusCode).toBe(404);
  });
});
