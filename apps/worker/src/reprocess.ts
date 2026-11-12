import type pg from "pg";
import { replaceJobSkills } from "./db/skills.js";
import { isTechJob } from "./extract/relevance.js";
import type { Enrichment } from "./pipeline.js";

/**
 * Recalcula skills e is_tech de TODAS las ofertas ya guardadas, usando el texto almacenado:
 * no llama a ninguna API (no gasta el cupo de las fuentes). Útil cuando mejoras skills.json
 * o las reglas de relevancia.
 */
export async function reprocessJobs(pool: pg.Pool, enrichment: Enrichment): Promise<{ processed: number; tech: number }> {
  const { rows } = await pool.query<{
    id: string;
    title: string;
    description: string | null;
    category: string | null;
    tags: string[];
  }>("SELECT id, title, description, category, tags FROM jobs ORDER BY id");

  const client = await pool.connect();
  let tech = 0;
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const skills = enrichment.extract(`${row.title}\n${row.description ?? ""}`);
      const isTech = isTechJob({ title: row.title, category: row.category, tags: row.tags, skills });
      await client.query("UPDATE jobs SET is_tech = $2 WHERE id = $1", [row.id, isTech]);
      await replaceJobSkills(client, row.id, skills, enrichment.skillIds);
      if (isTech) tech++;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { processed: rows.length, tech };
}
