import { isTechJob } from "./extract/relevance.js";
import type { SkillExtractor } from "./extract/skills.js";
import type { EnrichedJob, NormalizedJob } from "./types.js";

/** Extrae las skills del título + descripción y calcula si la oferta es de tecnología. */
export function enrichJob(job: NormalizedJob, extract: SkillExtractor): EnrichedJob {
  const skills = extract(`${job.title}\n${job.description ?? ""}`);
  const isTech = isTechJob({ title: job.title, category: job.category, tags: job.tags, skills });
  return { job, skills, isTech };
}
