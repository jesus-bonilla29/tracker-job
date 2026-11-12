-- 002_tags_and_relevance.sql
-- Etiquetas de la fuente y marca de relevancia tecnológica.

ALTER TABLE jobs
  ADD COLUMN tags    TEXT[]  NOT NULL DEFAULT '{}',   -- etiquetas originales de la fuente (p. ej. Arbeitnow)
  ADD COLUMN is_tech BOOLEAN NOT NULL DEFAULT FALSE;  -- ¿es una oferta de tecnología? (ver extract/relevance.ts)

-- Las consultas del dashboard filtran casi siempre por is_tech = true.
CREATE INDEX idx_jobs_is_tech ON jobs (posted_at) WHERE is_tech;
