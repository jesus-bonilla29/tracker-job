import { useMemo, useState, type FormEvent } from "react";
import { useMatch, useOverview, useTopSkills } from "../api/hooks";
import type { MatchJob } from "../api/types";
import { EmptyState, ErrorState, Segmented } from "../components/ui";
import { fmtInt, fmtPct, sourceColor, sourceLabel } from "../lib/format";
import { MAX_PROFILE, canonicalNames, matchHeadline, mergeSkills, removeSkill, splitSkills } from "../lib/match";
import { useParam } from "../lib/useParam";
import { JobItem } from "./JobsView";

const SUGGESTIONS = 10;

/** Lo que la oferta pide y ya tienes (relleno) frente a lo que te falta (borde discontinuo): no depende solo del color. */
function Fit({ job }: { job: MatchJob }) {
  const total = job.matched.length + job.missing.length;
  return (
    <>
      <p className="fit">
        <span className="fit-bar" aria-hidden="true">
          <i style={{ width: `${job.coverage}%` }} />
        </span>
        <span className="num">
          <strong>
            {job.matched.length} de {total}
          </strong>{" "}
          tecnologías que piden ({fmtPct(job.coverage)})
        </span>
      </p>
      <div className="tags">
        {job.matched.map((s) => (
          <span key={`h-${s}`} className="tag have">
            <span className="sr-only">Ya la tienes: </span>
            {s}
          </span>
        ))}
        {job.missing.map((s) => (
          <span key={`l-${s}`} className="tag lack">
            <span className="sr-only">Te falta: </span>
            {s}
          </span>
        ))}
      </div>
    </>
  );
}

export function MatchView() {
  const [urlSkills, setUrlSkills] = useParam("t", "");
  const [source, setSource] = useParam("fuente", "all");
  const [draft, setDraft] = useState("");

  const overview = useOverview();
  const catalog = useTopSkills(undefined);
  const names = useMemo(() => mergeSkills([], splitSkills(urlSkills)), [urlSkills]);
  const match = useMatch(names, source === "all" ? undefined : source);

  const setNames = (next: string[]) => setUrlSkills(next.join(","));
  const add = (raw: string) => {
    const added = splitSkills(raw);
    if (added.length > 0) setNames(mergeSkills(names, added));
    setDraft("");
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    add(draft);
  };

  const data = names.length > 0 ? match.data : undefined;
  const canon = canonicalNames(data?.profile.skills ?? []);
  const unknown = data?.profile.unknown ?? [];
  const unknownSet = new Set(unknown);

  const catalogNames = (catalog.data?.skills ?? []).map((s) => s.name);
  const chosen = new Set(names.map((n) => n.toLowerCase()));
  const suggestions = catalogNames.filter((n) => !chosen.has(n.toLowerCase())).slice(0, SUGGESTIONS);

  const sourceOptions = [
    { value: "all", label: "Todas" },
    ...(overview.data?.sources ?? []).map((s) => ({ value: s.source, label: sourceLabel(s.source), color: sourceColor(s.source) })),
  ];

  const title = data && data.summary.considered > 0 && data.profile.skills.length > 0 ? matchHeadline(data.summary) : "¿Qué ofertas encajan con lo que ya sabes?";

  return (
    <>
      <div className="page-head plain">
        <h1>{title}</h1>
        <p className="lede">
          Indica las tecnologías que ya conoces. Para cada oferta se calcula qué parte de las tecnologías que pide ya tienes, y se
          sugiere qué aprender después para encajar en más.
        </p>
      </div>

      <section className="profile" aria-label="Tus tecnologías">
        <form onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="mi-skill">
            Tecnologías que ya conoces, separadas por comas
          </label>
          <input
            id="mi-skill"
            className="field"
            list="catalogo-skills"
            value={draft}
            placeholder="React, TypeScript, Node.js…"
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
            disabled={names.length >= MAX_PROFILE}
          />
          <datalist id="catalogo-skills">
            {catalogNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button type="submit" className="btn" disabled={draft.trim() === "" || names.length >= MAX_PROFILE}>
            Añadir
          </button>
        </form>

        {names.length > 0 && (
          <div className="legend" aria-label="Tecnologías elegidas">
            {names.map((n) => {
              const shown = canon.get(n.toLowerCase()) ?? n;
              return (
                <span key={n.toLowerCase()} className="legend-item">
                  {shown}
                  {unknownSet.has(n.toLowerCase()) && <span className="sr-only"> (no reconocida)</span>}
                  <button type="button" aria-label={`Quitar ${shown}`} onClick={() => setNames(removeSkill(names, n))}>
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {suggestions.length > 0 && names.length < MAX_PROFILE && (
          <div className="suggest">
            <span id="sugeridas">{names.length === 0 ? "Para empezar, las más pedidas:" : "Más pedidas:"}</span>
            <div className="chips" role="group" aria-labelledby="sugeridas">
              {suggestions.map((n) => (
                <button key={n} type="button" className="chip" onClick={() => setNames(mergeSkills(names, [n]))}>
                  + {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {unknown.length > 0 && (
        <p className="notice" role="status">
          <strong>No reconocemos: {unknown.join(", ")}.</strong> Se ignoran. Usa el nombre habitual (por ejemplo <code>Node.js</code>, no{" "}
          <code>NodeJS</code>) o elige de la lista que aparece al escribir.
        </p>
      )}

      {names.length === 0 ? (
        <EmptyState title="Añade las tecnologías que ya conoces">
          Escribe varias separadas por comas, o pulsa las más pedidas. Verás qué ofertas encajan mejor y qué aprender después.
        </EmptyState>
      ) : match.error && !data ? (
        <ErrorState error={match.error} onRetry={() => void match.refetch()} />
      ) : !data ? (
        <p className="foot-note" aria-busy="true">Cargando…</p>
      ) : data.profile.skills.length === 0 ? (
        <EmptyState title="Ninguna de esas tecnologías está en el catálogo">
          Prueba con otras o con las sugeridas de arriba.
        </EmptyState>
      ) : (
        <>
          <div className="controls">
            <Segmented label="Fuente" name="fuente" value={source} options={sourceOptions} onChange={setSource} />
          </div>

          {data.summary.considered === 0 ? (
            <EmptyState title="No hay ofertas que comparar con este filtro">
              Solo se comparan las ofertas con al menos 3 tecnologías detectadas. Prueba con otra fuente.
            </EmptyState>
          ) : (
            <>
              <dl className="funnel">
                <div>
                  <dt>Todo lo que piden</dt>
                  <dd>{fmtInt(data.summary.full)}</dd>
                </div>
                <div>
                  <dt>Tres cuartas partes o más</dt>
                  <dd>{fmtInt(data.summary.atLeast75)}</dd>
                </div>
                <div>
                  <dt>La mitad o más</dt>
                  <dd>{fmtInt(data.summary.atLeast50)}</dd>
                </div>
              </dl>
              <p className="foot-note">
                Sobre {fmtInt(data.summary.considered)} ofertas tecnológicas con al menos 3 tecnologías detectadas.
              </p>

              <p className="notice">
                <strong>Es un cruce de listas, no una evaluación de ti.</strong> No mide tu nivel ni tu experiencia, y las tecnologías de
                cada oferta se detectan automáticamente de su texto. Los anuncios largos (Arbeitnow) listan más tecnologías que los
                cortos (Hacker News), así que tienden a salir con menos encaje: compara fuentes por separado.
              </p>

              {data.learnNext.length > 0 && (
                <section aria-labelledby="aprender">
                  <h2 id="aprender" className="section-title">Qué aprender después</h2>
                  <ul className="learn">
                    {data.learnNext.map((l) => (
                      <li key={l.name}>
                        <span>
                          <strong>{l.name}</strong>{" "}
                          <span className="why">
                            {l.unlocks > 0
                              ? `Es lo único que te falta en ${fmtInt(l.unlocks)} ${l.unlocks === 1 ? "oferta" : "ofertas"}`
                              : `La piden ${fmtInt(l.closeJobs)} ${l.closeJobs === 1 ? "oferta" : "ofertas"} que ya cubres a medias`}
                          </span>
                        </span>
                        <button type="button" className="btn ghost" onClick={() => setNames(mergeSkills(names, [l.name]))}>
                          Probar con {l.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {data.jobs.length > 0 && (
                <section aria-labelledby="mejores">
                  <h2 id="mejores" className="section-title">Las ofertas que mejor encajan</h2>
                  <p className="results-count">
                    Mostrando {fmtInt(data.jobs.length)} de {fmtInt(data.summary.withAnyMatch)} con algún acierto.
                  </p>
                  <ol className="jobs">
                    {data.jobs.map((job) => (
                      <JobItem key={job.id} job={job} extra={<Fit job={job} />} />
                    ))}
                  </ol>
                  <p className="foot-note">{data.attribution}</p>
                </section>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
