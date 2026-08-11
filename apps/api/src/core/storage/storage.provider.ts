export interface StoredFile {
  /** Chave interna. Nunca é uma URL pública — o acesso passa sempre pela API. */
  storageKey: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Armazenamento de arquivos enviados pelos funcionários.
 *
 * A interface existe para que trocar disco local por S3/R2 seja mudança de
 * configuração, não de código. Hoje roda em disco: funciona sem contratar
 * serviço nem gerenciar credenciais.
 */
export interface StorageProvider {
  readonly name: string;
  save(params: { content: Buffer; fileName: string; scope: string }): Promise<StoredFile>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}
