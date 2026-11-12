import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useJobs, useOverview } from "../api/hooks";
import type { JobSummary } from "../api/types";
import { EmptyState, ErrorState } from "../components/ui";
import { fmtDate, fmtInt, fmtSalary, safeHref, showRemoteBadge, sourceColor, sourceLabel } from "../lib/format";
import { useParam } from "../lib/useParam";

const MAX_TAGS = 8;

/** `extra` sustituye al bloque de etiquetas (lo usa Mi match para mostrar lo que ya tienes y lo que falta). */
export function JobItem({ job, extra }: { job: JobSummary; extra?: ReactNode }) {
  const salary = fmtSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const href = safeHref(job.url);
  return (
    <li className="job">
      <div>
        <h3>
          {/* La atribución es un requisito de las fuentes: el título siempre enlaza a la publicación original. */}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {job.title}
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
          ) : (
            job.title
          )}
        </h3>
        <div className="meta">
          {job.company && <span>{job.company}</span>}
          {job.location && <span>{job.location}</span>}
          {showRemoteBadge(job.isRemote, job.location) && <span>Remoto</span>}
          {salary && <span className="num">{salary}</span>}
        </div>
      </div>
      <div className="side-info">
        <span className="src">
          <i className="dot" style={{ ["--dot" as string]: sourceColor(job.source) }} aria-hidden="true" />
          {sourceLabel(job.source)}
        </span>
        {job.postedAt && <time dateTime={job.postedAt}>{fmtDate(job.postedAt)}</time>}
      </div>
      {extra ? (
        <div className="match-extra">{extra}</div>
      ) : (
        job.skills.length > 0 && (
          <div className="tags">
            {job.skills.slice(0, MAX_TAGS).map((s) => (
              <span key={s} className="tag">{s}</span>
            ))}
            {job.skills.length > MAX_TAGS && <span className="tag">+{job.skills.length - MAX_TAGS}</span>}
          </div>
        )
      )}
    </li>
  );
}

export function JobsView() {
  const [q, setQ] = useParam("q", "");
  const [skills, setSkills] = useParam("skills", "");
  const [source, setSource] = useParam("fuente", "");
  const [remote, setRemote] = useParam("remoto", "");
  const [salary, setSalary] = useParam("salario", "");
  const [sort, setSort] = useParam("orden", "recent");
  const [page, setPage] = useParam("pagina", "1");

  // Los campos de texto se aplican al enviar (no a cada tecla), para no lanzar una consulta por letra.
  const [draftQ, setDraftQ] = useState(q);
  const [draftSkills, setDraftSkills] = useState(skills);
  useEffect(() => setDraftQ(q), [q]);
  useEffect(() => setDraftSkills(skills), [skills]);

  const overview = useOverview();
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const jobs = useJobs({
    q: q || undefined,
    skills: skills || undefined,
    source: source || undefined,
    remote: remote === "1" ? true : undefined,
    hasSalary: salary === "1" ? true : undefined,
    sort,
    page: pageNum,
    pageSize: 20,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(draftQ.trim());
    setSkills(draftSkills.split(",").map((s) => s.trim()).filter(Boolean).join(","));
    setPage("1");
  };

  const reset = () => {
    setQ("");
    setSkills("");
    setSource("");
    setRemote("");
    setSalary("");
    setSort("recent");
    setPage("1");
  };

  return (
    <>
      <div className="page-head plain">
        <h1>Ofertas que encajan con tu perfil</h1>
        <p className="lede">
          Busca por texto y por tecnologías: la oferta debe mencionar todas las que indiques. Cada título enlaza a la publicación original.
        </p>
      </div>

      <form className="controls" onSubmit={submit} role="search" aria-label="Filtrar ofertas">
        <input className="field" type="search" placeholder="Título o empresa" aria-label="Título o empresa" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} />
        <input className="field" type="text" placeholder="Tecnologías: React, TypeScript" aria-label="Tecnologías separadas por comas" value={draftSkills} onChange={(e) => setDraftSkills(e.target.value)} />
        <select className="select" aria-label="Fuente" value={source} onChange={(e) => { setSource(e.target.value); setPage("1"); }}>
          <option value="">Todas las fuentes</option>
          {(overview.data?.sources ?? []).map((s) => (
            <option key={s.source} value={s.source}>{sourceLabel(s.source)}</option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={remote === "1"} onChange={(e) => { setRemote(e.target.checked ? "1" : ""); setPage("1"); }} />
          Solo remoto
        </label>
        <label className="check">
          <input type="checkbox" checked={salary === "1"} onChange={(e) => { setSalary(e.target.checked ? "1" : ""); setPage("1"); }} />
          Con salario
        </label>
        <select className="select" aria-label="Ordenar por" value={sort} onChange={(e) => { setSort(e.target.value); setPage("1"); }}>
          <option value="recent">Más recientes</option>
          <option value="salary">Mayor salario</option>
        </select>
        <button type="submit" className="btn">Buscar</button>
        <button type="button" className="btn ghost" onClick={reset}>Limpiar</button>
      </form>

      {jobs.isError ? (
        <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : jobs.isPending ? (
        <p className="foot-note" aria-busy="true">Cargando…</p>
      ) : jobs.data.data.length === 0 ? (
        <EmptyState title="Ninguna oferta cumple esos filtros">Prueba con menos tecnologías o quita algún filtro.</EmptyState>
      ) : (
        <>
          <p className="results-count num" aria-live="polite">
            {fmtInt(jobs.data.total)} {jobs.data.total === 1 ? "oferta" : "ofertas"}
          </p>
          <ul className="jobs">
            {jobs.data.data.map((j) => (
              <JobItem key={j.id} job={j} />
            ))}
          </ul>
          <nav className="pager num" aria-label="Paginación">
            <button type="button" className="btn ghost" disabled={pageNum <= 1} onClick={() => setPage(String(pageNum - 1))}>
              Anterior
            </button>
            <span>
              Página {pageNum} de {jobs.data.totalPages}
            </span>
            <button type="button" className="btn ghost" disabled={pageNum >= jobs.data.totalPages} onClick={() => setPage(String(pageNum + 1))}>
              Siguiente
            </button>
          </nav>
        </>
      )}
    </>
  );
}
