/** Formato común al que se normalizan las ofertas de TODAS las fuentes. */
export interface NormalizedJob {
  source: string;
  externalId: string;
  title: string;
  company: string | null;
  category: string | null;
  /** Etiquetas originales de la fuente (puede estar vacío). */
  tags: string[];
  jobType: string | null;
  location: string | null;
  isRemote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  /** Texto plano, sin HTML. */
  description: string | null;
  url: string;
  postedAt: Date | null;
  /** Objeto original de la fuente, para poder reprocesarlo más adelante. */
  raw: unknown;
}

/** Oferta ya procesada: lista para guardarse junto con sus skills y su marca de relevancia. */
export interface EnrichedJob {
  job: NormalizedJob;
  skills: string[];
  isTech: boolean;
}
