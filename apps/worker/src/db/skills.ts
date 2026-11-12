import type pg from "pg";
import type { SkillDefinition } from "../extract/skills.js";

/** Sincroniza la tabla `skills` con data/skills.json (idempotente). Devuelve nombre -> id. */
export async function syncSkills(pool: pg.Pool, definitions: SkillDefinition[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const d of definitions) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO skills (name, category, aliases)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category, aliases = EXCLUDED.aliases
         RETURNING id`,
        [d.name, d.category, [...d.aliases, ...d.exact, ...d.weak]],
      );
      ids.set(d.name, rows[0]!.id);
    }
    await client.query("COMMIT");
    return ids;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Reemplaza las skills de una oferta por la lista dada. Usar dentro de una transacción (recibe el cliente). */
export async function replaceJobSkills(
  client: Pick<pg.PoolClient, "query">,
  jobId: number | string,
  skills: string[],
  skillIds: Map<string, number>,
): Promise<void> {
  const ids = skills.map((name) => {
    const id = skillIds.get(name);
    if (id === undefined) throw new Error(`Skill desconocida (no está en el catálogo): ${name}`);
    return id;
  });
  await client.query("DELETE FROM job_skills WHERE job_id = $1", [jobId]);
  if (ids.length > 0) {
    await client.query("INSERT INTO job_skills (job_id, skill_id) SELECT $1, unnest($2::int[])", [jobId, ids]);
  }
}
