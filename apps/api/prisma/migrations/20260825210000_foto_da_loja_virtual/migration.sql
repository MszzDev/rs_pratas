-- Endereço da foto que já está publicada na loja virtual.
--
-- A importação traz o produto com a foto sem baixar arquivo nenhum: as fotos
-- vivem na Nuvemshop, e copiá-las encheria o disco do servidor — que no plano
-- gratuito é apagado a cada publicação, levando as fotos junto.
--
-- Foto enviada pelo sistema continua tendo precedência sobre esta.
ALTER TABLE "products" ADD COLUMN "imageExternalUrl" TEXT;
