-- Foto da peca.
--
-- So a chave do arquivo fica no banco; o binario vive no disco, fora da raiz
-- web. Guardar a imagem no banco incharia o dump de backup a ponto de a
-- restauracao deixar de ser rotina.
ALTER TABLE "products" ADD COLUMN "imageStorageKey" TEXT;
ALTER TABLE "products" ADD COLUMN "imageMimeType" TEXT;
ALTER TABLE "products" ADD COLUMN "imageChecksum" TEXT;
