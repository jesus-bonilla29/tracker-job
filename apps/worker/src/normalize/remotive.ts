import type { RemotiveJob } from "../sources/remotive.js";
import type { NormalizedJob } from "../types.js";
import { parseSalary } from "../extract/salary.js";
import { htmlToText } from "../lib/html.js";

/**
 * Remotive entrega `publication_date` sin zona horaria (p. ej. "2020-02-15T10:23:26").
 * Asumimos UTC; si resulta no ser así, se corrige aquí en un único lugar.
 */
function parsePublicationDate(value: string | null): Date | null {
  if (!value) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeRemotiveJob(job: RemotiveJob, raw: unknown): NormalizedJob {
  const salary = parseSalary(job.salary);

  return {
    source: "remotive",
    externalId: String(job.id),
    title: job.title,
    company: job.company_name,
    category: job.category,
    tags: [],
    jobType: job.job_type,
    location: job.candidate_required_location,
    isRemote: true, // Remotive solo publica trabajos remotos
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    description: htmlToText(job.description),
    url: job.url,
    postedAt: parsePublicationDate(job.publication_date),
    raw,
  };
}
