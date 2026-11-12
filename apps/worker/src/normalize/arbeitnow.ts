import type { ArbeitnowJob } from "../sources/arbeitnow.js";
import type { NormalizedJob } from "../types.js";
import { htmlToText } from "../lib/html.js";

/** Arbeitnow mezcla etiquetas en inglés y alemán; las llevamos al mismo vocabulario que Remotive. */
const JOB_TYPE_MAP: Record<string, string> = {
  "full time": "full_time",
  vollzeit: "full_time",
  "part time": "part_time",
  teilzeit: "part_time",
  contract: "contract",
  freelance: "freelance",
  internship: "internship",
  praktikum: "internship",
  werkstudent: "internship",
};

export function normalizeJobType(types: string[]): string | null {
  const first = types.map((t) => t.trim().toLowerCase()).find((t) => t !== "");
  if (!first) return null;
  return JOB_TYPE_MAP[first] ?? first.replace(/\s+/g, "_");
}

export function normalizeArbeitnowJob(job: ArbeitnowJob, raw: unknown): NormalizedJob {
  return {
    source: "arbeitnow",
    externalId: job.slug,
    title: job.title,
    company: job.company_name,
    category: job.tags[0] ?? null,
    tags: job.tags,
    jobType: normalizeJobType(job.job_types),
    location: job.location,
    isRemote: job.remote,
    salaryMin: null, // la API pública de Arbeitnow no expone salarios
    salaryMax: null,
    salaryCurrency: null,
    description: htmlToText(job.description),
    url: job.url,
    postedAt: job.created_at ? new Date(job.created_at * 1000) : null,
    raw,
  };
}
