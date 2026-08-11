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

/** Monta um corpo multipart simples, com um campo de arquivo e campos de texto. */
function multipartBody(params: {
  fields: Record<string, string>;
  fileName: string;
  mimeType: string;
  content: Buffer;
}) {
  const boundary = `----teste${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];

  for (const [name, value] of Object.entries(params.fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${params.fileName}"\r\n` +
        `Content-Type: ${params.mimeType}\r\n\r\n`,
    ),
    params.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );

  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

/** Um PDF mínimo, grande o bastante para não cair na regra de arquivo curto. */
const FAKE_PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.alloc(20_000, 0x20),
  Buffer.from("\n%%EOF"),
]);

async function upload(
  token: string,
  overrides: Partial<{ type: string; title: string; referenceStart: string; referenceEnd: string }> = {},
  content: Buffer = FAKE_PDF,
) {
  const body = multipartBody({
    fields: {
      type: overrides.type ?? "MEDICAL_CERTIFICATE",
      title: overrides.title ?? "Atestado de 2 dias",
      ...(overrides.referenceStart ? { referenceStart: overrides.referenceStart } : {}),
      ...(overrides.referenceEnd ? { referenceEnd: overrides.referenceEnd } : {}),
    },
    fileName: "atestado.pdf",
    mimeType: "application/pdf",
    content,
  });

  return app.inject({
    method: "POST",
    url: "/api/v1/documents",
    headers: { ...auth(token), ...body.headers },
    payload: body.payload,
  });
}

async function setup() {
  const company = await createTestCompany();
  const store = await createTestStore(company.id);

  const { user: seller, password: sellerPassword } = await createTestUser({
    companyId: company.id,
    role: "VENDEDOR",
  });
  await prisma.userStore.create({ data: { userId: seller.id, storeId: store.id } });

  const { user: manager, password: managerPassword } = await createTestUser({
    companyId: company.id,
    role: "GERENTE",
  });
  await prisma.userStore.create({ data: { userId: manager.id, storeId: store.id } });

  const sellerToken = await authenticate(seller.employeeCode, sellerPassword);
  const managerToken = await authenticate(manager.employeeCode, managerPassword);

  return { company, store, seller, sellerToken, manager, managerToken };
}

describe("envio de documento pelo funcionário", () => {
  it("aceita o arquivo e devolve o parecer automático", async () => {
    const { sellerToken } = await setup();

    const response = await upload(sellerToken);

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("PENDING_REVIEW");
    expect(body.analysisVerdict).toBeTypeOf("string");
    expect(Array.isArray(body.analysisFindings)).toBe(true);
  });

  it("o arquivo não é guardado com o nome enviado — nome não vira caminho", async () => {
    const { sellerToken } = await setup();

    const body = multipartBody({
      fields: { type: "OTHER", title: "Comprovante qualquer" },
      fileName: "../../../etc/passwd.pdf",
      mimeType: "application/pdf",
      content: FAKE_PDF,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/documents",
      headers: { ...auth(sellerToken), ...body.headers },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(201);
    // A chave de armazenamento é gerada, nunca derivada do nome informado.
    expect(response.json().fileStorageKey).not.toContain("..");
    expect(response.json().fileStorageKey).not.toContain("passwd");
  });

  it("aponta arquivo repetido comparando o conteúdo, não o nome", async () => {
    const { sellerToken } = await setup();

    await upload(sellerToken);
    const segunda = await upload(sellerToken, { title: "Outro título, mesmo arquivo" });

    const findings = segunda.json().analysisFindings as string[];
    expect(findings.join(" ")).toContain("já foi enviado antes");
    expect(segunda.json().analysisVerdict).toBe("NEEDS_ATTENTION");
  });

  it("recusa arquivo vazio", async () => {
    const { sellerToken } = await setup();

    const response = await upload(sellerToken, {}, Buffer.alloc(0));

    expect(response.statusCode).toBe(400);
  });

  it("pede as datas quando o atestado vem sem período", async () => {
    const { sellerToken } = await setup();

    const response = await upload(sellerToken);
    const findings = response.json().analysisFindings as string[];

    expect(findings.join(" ")).toContain("Período de afastamento não informado");
  });

  it("aponta afastamento longo, que costuma virar caso de INSS", async () => {
    const { sellerToken } = await setup();

    const start = new Date();
    const end = new Date(Date.now() + 30 * 86_400_000);

    const response = await upload(sellerToken, {
      referenceStart: start.toISOString().slice(0, 10),
      referenceEnd: end.toISOString().slice(0, 10),
    });

    const findings = response.json().analysisFindings as string[];
    expect(findings.join(" ")).toContain("INSS");
  });
});

describe("conferência pelo gerente", () => {
  it("o gerente vê os documentos dos funcionários da loja dele", async () => {
    const { sellerToken, managerToken } = await setup();
    await upload(sellerToken);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/documents/review",
      headers: auth(managerToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  it("o gerente não vê documentos de funcionário de outra loja", async () => {
    const contextA = await setup();
    const outraLoja = await createTestStore(contextA.company.id, "L99");

    const { user: outroVendedor, password } = await createTestUser({
      companyId: contextA.company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: outroVendedor.id, storeId: outraLoja.id } });
    const outroToken = await authenticate(outroVendedor.employeeCode, password);

    await upload(outroToken);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/documents/review",
      headers: auth(contextA.managerToken),
    });

    expect(response.json()).toHaveLength(0);
  });

  it("aprovar exige motivo e registra que a decisão foi humana", async () => {
    const { sellerToken, managerToken } = await setup();
    const documentId = (await upload(sellerToken)).json().id as string;

    const semMotivo = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${documentId}/review`,
      headers: auth(managerToken),
      payload: { approve: true, comment: "ok" },
    });
    expect(semMotivo.statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${documentId}/review`,
      headers: auth(managerToken),
      payload: { approve: true, comment: "conferido com o funcionário" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("APPROVED");

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: documentId, entityType: "EmployeeDocument", action: "USER_UPDATE" },
    });
    expect(entry?.reason).toBe("conferido com o funcionário");
    expect(entry?.metadata).toMatchObject({ decision: "human" });
  });

  it("a análise nunca decide sozinha — documento entra sempre pendente", async () => {
    const { sellerToken } = await setup();

    const response = await upload(sellerToken);

    // Mesmo com pontos de atenção levantados, quem decide é uma pessoa.
    expect(response.json().analysisFindings.length).toBeGreaterThan(0);
    expect(response.json().status).toBe("PENDING_REVIEW");
    expect(response.json().reviewedAt).toBeNull();
  });

  it("ninguém confere o próprio documento", async () => {
    const { managerToken } = await setup();
    const documentId = (await upload(managerToken)).json().id as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${documentId}/review`,
      headers: auth(managerToken),
      payload: { approve: true, comment: "aprovando o meu próprio" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("CANNOT_REVIEW_OWN_DOCUMENT");
  });

  it("não confere duas vezes", async () => {
    const { sellerToken, managerToken } = await setup();
    const documentId = (await upload(sellerToken)).json().id as string;

    const payload = { approve: true, comment: "conferido" };
    await app.inject({
      method: "POST",
      url: `/api/v1/documents/${documentId}/review`,
      headers: auth(managerToken),
      payload,
    });

    const segunda = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${documentId}/review`,
      headers: auth(managerToken),
      payload,
    });

    expect(segunda.statusCode).toBe(400);
    expect(segunda.json().error.code).toBe("ALREADY_REVIEWED");
  });

  it("vendedor não confere documento de ninguém", async () => {
    const { sellerToken, managerToken } = await setup();
    const documentId = (await upload(managerToken)).json().id as string;

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${documentId}/review`,
      headers: auth(sellerToken),
      payload: { approve: true, comment: "tentativa indevida" },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("acesso ao arquivo", () => {
  it("o funcionário baixa o próprio documento", async () => {
    const { sellerToken } = await setup();
    const documentId = (await upload(sellerToken)).json().id as string;

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${documentId}/file`,
      headers: auth(sellerToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    // Dado de saúde não pode ficar em cache do navegador.
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("o download fica registrado na auditoria", async () => {
    const { sellerToken, managerToken } = await setup();
    const documentId = (await upload(sellerToken)).json().id as string;

    await app.inject({
      method: "GET",
      url: `/api/v1/documents/${documentId}/file`,
      headers: auth(managerToken),
    });

    const entry = await prisma.auditLog.findFirst({
      where: { entityId: documentId, reason: "download de documento" },
    });
    expect(entry).not.toBeNull();
  });

  it("funcionário de outra loja não alcança o arquivo", async () => {
    const contextA = await setup();
    const documentId = (await upload(contextA.sellerToken)).json().id as string;

    const outraLoja = await createTestStore(contextA.company.id, "L98");
    const { user: estranho, password } = await createTestUser({
      companyId: contextA.company.id,
      role: "VENDEDOR",
    });
    await prisma.userStore.create({ data: { userId: estranho.id, storeId: outraLoja.id } });
    const token = await authenticate(estranho.employeeCode, password);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${documentId}/file`,
      headers: auth(token),
    });

    expect(response.statusCode).toBe(403);
  });
});
