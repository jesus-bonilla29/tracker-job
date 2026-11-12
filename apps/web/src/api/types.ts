// Formas de las respuestas de la API (ver /api/docs). Se mantienen a mano: son pocas y estables.

export interface EtlRun {
  source: string;
  status: "running" | "ok" | "error";
  startedAt: string;
  finishedAt: string | null;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}
export interface Health {
  status: "ok";
  database: "up";
  etl: EtlRun[];
}

export interface SourceOverview {
  source: string;
  jobs: number;
  techJobs: number;
  latestPostedAt: string | null;
  newLast24h: number;
}
export interface Overview {
  totals: { jobs: number; techJobs: number; sources: number; skillsInCatalog: number };
  sources: SourceOverview[];
}

export interface SkillShare {
  name: string;
  category: string | null;
  jobs: number;
  pct: number;
}
export interface TopSkills {
  totalJobs: number;
  skills: SkillShare[];
}

export interface TrendPoint {
  period: string;
  jobs: number;
  mentions: number;
  pct: number;
}
export interface SkillTrend {
  skill: { name: string; category: string | null };
  interval: "week" | "month";
  series: TrendPoint[];
}

export interface Diff {
  name: string;
  pctA: number;
  pctB: number;
  diff: number;
  jobsA: number;
  jobsB: number;
}
export interface SourceComparison {
  a: { source: string; techJobs: number };
  b: { source: string; techJobs: number };
  moreInA: Diff[];
  moreInB: Diff[];
  note: string;
}

export interface JobSummary {
  id: number;
  source: string;
  title: string;
  company: string | null;
  location: string | null;
  isRemote: boolean;
  isTech: boolean;
  jobType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: string | null;
  url: string;
  skills: string[];
}
export interface JobList {
  attribution: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  data: JobSummary[];
}

export interface MatchSummary {
  considered: number;
  withAnyMatch: number;
  atLeast50: number;
  atLeast75: number;
  full: number;
}
export interface LearnNext {
  name: string;
  category: string | null;
  /** Ofertas en las que esta es la ÚNICA tecnología que falta. */
  unlocks: number;
  /** Ofertas que ya se cubren a medias o más y que piden esta tecnología. */
  closeJobs: number;
}
export interface MatchJob extends JobSummary {
  matched: string[];
  missing: string[];
  coverage: number;
}
export interface MatchResult {
  attribution: string;
  profile: { skills: string[]; unknown: string[] };
  summary: MatchSummary;
  learnNext: LearnNext[];
  jobs: MatchJob[];
}
