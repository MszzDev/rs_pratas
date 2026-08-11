import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import type { StorageProvider, StoredFile } from "./storage.provider.js";

/**
 * Guarda os arquivos numa pasta do servidor, fora da raiz web.
 *
 * Nada aqui é servido estaticamente: o download passa pela API, que valida
 * permissão antes de entregar o conteúdo. Um atestado médico não pode ficar
 * acessível por quem descobrir a URL.
 */
export class LocalDiskStorage implements StorageProvider {
  readonly name = "local-disk";

  constructor(private readonly baseDir: string) {}

  async save(params: { content: Buffer; fileName: string; scope: string }): Promise<StoredFile> {
    const checksum = createHash("sha256").update(params.content).digest("hex");

    // O nome original nunca vira caminho: um "../../.env" enviado como nome de
    // arquivo escreveria fora da pasta. Guardamos com nome gerado, preservando
    // só a extensão.
    const extension = sanitizeExtension(params.fileName);
    const storageKey = join(sanitizeScope(params.scope), `${randomUUID()}${extension}`);

    const target = this.resolveSafe(storageKey);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, params.content);

    return { storageKey, sizeBytes: params.content.byteLength, checksum };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveSafe(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await unlink(this.resolveSafe(storageKey)).catch(() => undefined);
  }

  /**
   * Garante que o caminho final continua dentro da pasta base, mesmo que a
   * chave venha adulterada com "..".
   */
  private resolveSafe(storageKey: string): string {
    const base = resolve(this.baseDir);
    const target = resolve(base, normalize(storageKey));

    if (target !== base && !target.startsWith(base + sep)) {
      throw new Error("Caminho de arquivo inválido.");
    }

    return target;
  }
}

function sanitizeExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
}

function sanitizeScope(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9-]/g, "");
}
