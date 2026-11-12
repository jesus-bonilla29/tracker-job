import type { Config, SourceName } from "../config.js";
import { normalizeArbeitnowJob } from "../normalize/arbeitnow.js";
import { normalizeHnComment } from "../normalize/hn.js";
import { normalizeRemotiveJob } from "../normalize/remotive.js";
import type { NormalizedJob } from "../types.js";
import { fetchArbeitnowJobs } from "./arbeitnow.js";
import { fetchHnComments } from "./hn.js";
import { fetchRemotiveJobs } from "./remotive.js";

/** Contrato que cumple cada fuente: devuelve ofertas ya normalizadas y cuántas descartó por datos inválidos. */
export interface Source {
  name: string;
  fetch(): Promise<{ jobs: NormalizedJob[]; invalid: number }>;
}

/** Para añadir una fuente nueva: implementa `Source` y regístrala aquí. */
export function createSource(name: SourceName, config: Config): Source {
  switch (name) {
    case "remotive":
      return {
        name,
        async fetch() {
          const r = await fetchRemotiveJobs({ category: config.REMOTIVE_CATEGORY });
          return { jobs: r.jobs.map((job, i) => normalizeRemotiveJob(job, r.rawJobs[i])), invalid: r.invalid };
        },
      };
    case "arbeitnow":
      return {
        name,
        async fetch() {
          const r = await fetchArbeitnowJobs({ maxPages: config.ARBEITNOW_MAX_PAGES });
          return { jobs: r.jobs.map((job, i) => normalizeArbeitnowJob(job, r.rawJobs[i])), invalid: r.invalid };
        },
      };
    case "hn":
      return {
        name,
        async fetch() {
          const r = await fetchHnComments({ threads: config.HN_THREADS });
          const jobs = r.comments.flatMap((c) => normalizeHnComment(c) ?? []);
          // Comentarios que no son ofertas (meta, respuestas sin cabecera) cuentan como descartados.
          return { jobs, invalid: r.invalid + (r.comments.length - jobs.length) };
        },
      };
  }
}
