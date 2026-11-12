-- 001_init.sql
-- Esquema inicial del Tech Job Tracker.

-- Una fila por oferta única (identificada por fuente + id externo).
CREATE TABLE jobs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT        NOT NULL,            -- 'remotive' | 'arbeitnow' | 'hn'
  external_id     TEXT        NOT NULL,            -- id de la oferta en la fuente original
  title           TEXT        NOT NULL,
  company         TEXT,
  category        TEXT,                            -- categoría de la fuente (p. ej. 'Software Development')
  job_type        TEXT,                            -- 'full_time' | 'contract' | 'part_time' | ...
  location        TEXT,                            -- restricción geográfica para candidatos
  is_remote       BOOLEAN     NOT NULL DEFAULT FALSE,
  seniority       TEXT,                            -- 'junior' | 'mid' | 'senior' (se infiere más adelante)
  salary_min      INTEGER,
  salary_max      INTEGER,
  salary_currency TEXT,                            -- 'USD', 'EUR', 'GBP'...
  description     TEXT,                            -- texto plano (sin HTML)
  url             TEXT        NOT NULL,            -- enlace a la oferta original (requisito de atribución)
  posted_at       TIMESTAMPTZ,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw             JSONB,                           -- respuesta original, para reprocesar sin volver a llamar a la API
  CONSTRAINT jobs_source_external_id_key UNIQUE (source, external_id),
  CONSTRAINT jobs_salary_range_chk CHECK (
    salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max
  )
);

CREATE INDEX idx_jobs_posted_at     ON jobs (posted_at);
CREATE INDEX idx_jobs_first_seen_at ON jobs (first_seen_at);
CREATE INDEX idx_jobs_source        ON jobs (source);

-- Catálogo de tecnologías (se poblará desde data/skills.json en la semana 2).
CREATE TABLE skills (
  id       SERIAL PRIMARY KEY,
  name     TEXT   NOT NULL UNIQUE,                 -- 'TypeScript'
  category TEXT,                                   -- 'language' | 'framework' | 'database' | 'cloud' ...
  aliases  TEXT[] NOT NULL DEFAULT '{}'            -- {'ts','typescript'}
);

-- Relación muchos a muchos entre ofertas y tecnologías.
CREATE TABLE job_skills (
  job_id   BIGINT  NOT NULL REFERENCES jobs (id)   ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  PRIMARY KEY (job_id, skill_id)
);

CREATE INDEX idx_job_skills_skill ON job_skills (skill_id);

-- Registro de ejecuciones del ETL (observabilidad y guarda de frecuencia).
CREATE TABLE etl_runs (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT        NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  fetched     INTEGER     NOT NULL DEFAULT 0,      -- ofertas recibidas de la API
  inserted    INTEGER     NOT NULL DEFAULT 0,      -- ofertas nuevas
  updated     INTEGER     NOT NULL DEFAULT 0,      -- ofertas ya conocidas
  skipped     INTEGER     NOT NULL DEFAULT 0,      -- ofertas descartadas por datos inválidos
  status      TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  error       TEXT
);

CREATE INDEX idx_etl_runs_source_started ON etl_runs (source, started_at DESC);
