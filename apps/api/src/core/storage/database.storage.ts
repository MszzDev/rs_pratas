import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { prisma } from "../../db/prisma.js";
import type { StorageProvider, StoredFile } from "./storage.provider.js";

/**
 * Guarda os arquivos dentro do banco.
 *
 * Existe porque o disco do servidor é descartável: a hospedagem o apaga a cada
 * publicação, e foto de peça e documento de funcionário sumiam junto — sem
 * aviso, com o cadastro continuando a apontar para um arquivo que não existia
 * mais. O problema só aparecia quando alguém abria a peça na tela, dias
 * depois.
 *
 * A escolha entre banco, disco permanente e armazenamento de objetos foi
 * decidida por uma pergunta prática: o que entra no backup? A cópia semanal do
 * banco já é feita e já foi testada restaurando. Arquivo no disco ficaria de
 * fora dela, e um arquivo que não está em backup nenhum é um arquivo que se
 * perde — só que mais devagar.
 */
export class DatabaseStorage implements StorageProvider {
  readonly name = "database";

  async save(params: { content: Buffer; fileName: string; scope: string }): Promise<StoredFile> {
    const checksum = createHash("sha256").update(params.content).digest("hex");

    // A chave é sorteada, e não derivada do nome nem sequencial. Ela viaja na
    // URL de download, então precisa ser impossível de adivinhar: com id
    // sequencial, qualquer sessão autenticada varreria os documentos de todo
    // mundo trocando um número.
    const key = `${limparEscopo(params.scope)}/${randomUUID()}${limparExtensao(params.fileName)}`;

    await prisma.storedFile.create({
      data: {
        key,
        scope: limparEscopo(params.scope),
        content: params.content,
        sizeBytes: params.content.byteLength,
        checksum,
      },
    });

    return { storageKey: key, sizeBytes: params.content.byteLength, checksum };
  }

  async read(storageKey: string): Promise<Buffer> {
    const arquivo = await prisma.storedFile.findUnique({
      where: { key: storageKey },
      select: { content: true },
    });

    if (!arquivo) {
      /**
       * Cadastro apontando para arquivo que não existe.
       *
       * O caso comum não é adulteração: são os arquivos enviados ANTES desta
       * mudança, que moravam no disco e foram apagados por uma publicação. A
       * mensagem diz isso, porque "arquivo não encontrado" faria alguém
       * procurar um defeito que não existe.
       */
      throw new Error(
        "ARQUIVO_PERDIDO: este arquivo foi enviado antes de o sistema passar a guardá-los no banco e não sobreviveu a uma publicação. Envie de novo.",
      );
    }

    return Buffer.from(arquivo.content);
  }

  async delete(storageKey: string): Promise<void> {
    // deleteMany, e não delete: apagar o que já não está lá não é erro, e
    // derrubar a troca de foto porque a antiga sumiu seria punir o usuário
    // pelo problema que esta classe veio resolver.
    await prisma.storedFile.deleteMany({ where: { key: storageKey } });
  }
}

/** Só a extensão, e minúscula. O nome que o navegador manda é do cliente. */
function limparExtensao(fileName: string): string {
  const extensao = extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extensao) ? extensao : "";
}

function limparEscopo(scope: string): string {
  return scope.replace(/[^a-zA-Z0-9-]/g, "");
}
