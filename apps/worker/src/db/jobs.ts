import type pg from "pg";
import type { EnrichedJob } from "../types.js";
import { replaceJobSkills } from "./skills.js";

export interface UpsertSummary {
  inserted: number;
  updated: number;
}

/**
 * Inserta o actualiza ofertas (y sus skills) de forma idempotente: ejecutar el ETL dos veces no duplica datos.
 *  - Oferta nueva    -> se inserta (first_seen_at = ahora).
 *  - Oferta ya vista -> se refrescan sus campos y last_seen_at; first_seen_at NO cambia.
 * Todo ocurre en una transacción: o se guardan todas o ninguna.
 */
export async function upsertJobs(
  pool: pg.Pool,
  items: EnrichedJob[],
  skillIds: Map<string, number>,
): Promise<UpsertSummary> {
  const summary: UpsertSummary = { inserted: 0, updated: 0 };
  if (items.length === 0) return summary;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const { job: j, skills, isTech } of items) {
      const { rows } = await client.query<{ id: string; inserted: boolean }>(
        `INSERT INTO jobs (
           source, external_id, title, company, category, tags, job_type, location, is_remote,
           salary_min, salary_max, salary_currency, description, url, posted_at, is_tech, raw
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (source, external_id) DO UPDATE SET
           title           = EXCLUDED.title,
           company         = EXCLUDED.company,
           category        = EXCLUDED.category,
           tags            = EXCLUDED.tags,
           job_type        = EXCLUDED.job_type,
           location        = EXCLUDED.location,
           is_remote       = EXCLUDED.is_remote,
           salary_min      = EXCLUDED.salary_min,
           salary_max      = EXCLUDED.salary_max,
           salary_currency = EXCLUDED.salary_currency,
           description     = EXCLUDED.description,
           url             = EXCLUDED.url,
           posted_at       = EXCLUDED.posted_at,
           is_tech         = EXCLUDED.is_tech,
           raw             = EXCLUDED.raw,
           last_seen_at    = now()
         RETURNING id, (xmax = 0) AS inserted`,
        [
          j.source,
          j.externalId,
          j.title,
          j.company,
          j.category,
          j.tags,
          j.jobType,
          j.location,
          j.isRemote,
          j.salaryMin,
          j.salaryMax,
          j.salaryCurrency,
          j.description,
          j.url,
          j.postedAt,
          isTech,
          JSON.stringify(j.raw),
        ],
      );

      const row = rows[0]!;
      await replaceJobSkills(client, row.id, skills, skillIds);
      if (row.inserted) summary.inserted++;
      else summary.updated++;
    }

    await client.query("COMMIT");
    return summary;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
