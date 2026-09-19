BEGIN;
-- NULL preserva o tamanho de lote de todos os pools existentes.
ALTER TABLE public.media_pools ADD COLUMN IF NOT EXISTS first_batch_size integer
  CHECK (first_batch_size IS NULL OR first_batch_size >= 1);
-- O valor 6 é preenchido na criação pelo painel; não modifica pools existentes.
COMMIT;
