import { useEffect, useMemo, useState } from "react";
import { useOverview, useSkillTrends, useTopSkills } from "../api/hooks";
import { TrendChart } from "../components/TrendChart";
import { EmptyState, ErrorState, Segmented } from "../components/ui";
import { fmtPct, fmtPeriod, sourceColor, sourceLabel } from "../lib/format";
import { LOW_SAMPLE, MAX_SKILLS, addSelected, mergeTrends, removeSelected, type Selected } from "../lib/trend";
import { useParam } from "../lib/useParam";

/** Con menos periodos que esto no hay "tendencia" que dibujar: se explica cómo cargar más historia. */
const MIN_PERIODS = 3;

export function TrendView() {
  const [source, setSource] = useParam("fuente", "all");
  const [interval, setInterval] = useParam("intervalo", "month");
  const [urlSkills, setUrlSkills] = useParam("t", "");
  const [asTable, setAsTable] = useState(false);

  const overview = useOverview();
  const catalog = useTopSkills(undefined); // todas las fuentes: sirve de lista de tecnologías disponibles
  const iv: "week" | "month" = interval === "week" ? "week" : "month";

  const [selected, setSelected] = useState<Selected[] | null>(() => {
    const names = urlSkills.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_SKILLS);
    return names.length ? names.reduce<Selected[]>((acc, n) => addSelected(acc, n), []) : null;
  });

  // Sin selección en la URL, empezamos con las 3 más pedidas.
  useEffect(() => {
    if (selected === null && catalog.data) {
      setSelected(catalog.data.skills.slice(0, MAX_SKILLS).reduce<Selected[]>((acc, s) => addSelected(acc, s.name), []));
    }
  }, [selected, catalog.data]);

  const current = selected ?? [];
  const update = (next: Selected[]) => {
    setSelected(next);
    setUrlSkills(next.map((s) => s.name).join(","));
  };

  const names = current.map((s) => s.name);
  const trends = useSkillTrends(names, iv, source === "all" ? undefined : source);
  const rows = useMemo(() => (trends.data ? mergeTrends(trends.data) : []), [trends.data]);

  const available = (catalog.data?.skills ?? []).map((s) => s.name).filter((n) => !names.includes(n)).sort((a, b) => a.localeCompare(b));

  const sourceOptions = [
    { value: "all", label: "Todas" },
    ...(overview.data?.sources ?? []).map((s) => ({ value: s.source, label: sourceLabel(s.source), color: sourceColor(s.source) })),
  ];

  const title =
    current.length === 0
      ? "Cómo cambia la demanda en el tiempo"
      : `Evolución de ${current.map((s) => s.name).join(", ")}`;

  return (
    <>
      <div className="page-head plain">
        <h1>{title}</h1>
        <p className="lede">
          Porcentaje de las ofertas de tecnología publicadas en cada periodo que mencionan la tecnología. Se agrupa por la fecha de
          publicación de la oferta.
        </p>
      </div>

      <div className="controls">
        <Segmented
          label="Agrupar por"
          name="intervalo"
          value={iv}
          options={[
            { value: "month", label: "Mes" },
            { value: "week", label: "Semana" },
          ]}
          onChange={setInterval}
        />
        <Segmented label="Fuente" name="fuente" value={source} options={sourceOptions} onChange={setSource} />
      </div>

      <div className="legend" aria-label="Tecnologías seleccionadas">
        {current.map((s) => (
          <span key={s.name} className="legend-item">
            <i className="dot" style={{ ["--dot" as string]: `var(--series-${s.slot})` }} aria-hidden="true" />
            {s.name}
            <button type="button" aria-label={`Quitar ${s.name}`} onClick={() => update(removeSelected(current, s.name))}>
              ×
            </button>
          </span>
        ))}
        {current.length < MAX_SKILLS && (
          <select
            className="select"
            aria-label="Añadir tecnología"
            value=""
            onChange={(e) => e.target.value && update(addSelected(current, e.target.value))}
          >
            <option value="">{current.length === 0 ? "Elige una tecnología" : "Añadir otra…"}</option>
            {available.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
        <span className="hollow-note">
          <i aria-hidden="true" /> Punto hueco: menos de {LOW_SAMPLE} ofertas en el periodo
        </span>
      </div>

      {trends.error ? (
        <ErrorState error={trends.error} onRetry={trends.refetch} />
      ) : current.length === 0 ? (
        <EmptyState title="Elige una tecnología">Añade hasta {MAX_SKILLS} para ver y comparar su evolución.</EmptyState>
      ) : trends.isPending ? (
        <p className="foot-note" aria-busy="true">Cargando…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Sin datos con fecha para esta selección">
          Las ofertas sin fecha de publicación no entran en las tendencias. Prueba con otra fuente.
        </EmptyState>
      ) : (
        <>
          {asTable ? (
            <div className="table-wrap">
              <table className="data num">
                <caption>Porcentaje de ofertas que mencionan la tecnología, por {iv === "week" ? "semana" : "mes"} (menciones de ofertas)</caption>
                <thead>
                  <tr>
                    <th scope="col">{iv === "week" ? "Semana del" : "Mes"}</th>
                    {current.map((s) => (
                      <th key={s.name} scope="col" className="r">{s.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.period}>
                      <th scope="row">{fmtPeriod(r.period, iv)}</th>
                      {current.map((s) => {
                        const d = r.detail[s.name];
                        return (
                          <td key={s.name} className="r">
                            {d ? `${fmtPct(d.pct)} (${d.mentions} de ${d.jobs})` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <TrendChart rows={rows} selected={current} interval={iv} />
          )}

          <div className="more">
            <button type="button" className="btn ghost" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? "Ver como gráfico" : "Ver como tabla"}
            </button>
          </div>

          {rows.length < MIN_PERIODS && (
            <p className="notice" style={{ marginTop: "1.25rem" }}>
              <strong>Todavía hay pocos periodos ({rows.length}).</strong> Una tendencia necesita varios. Para cargar meses anteriores de
              Hacker News, sube <code>HN_THREADS</code> en tu <code>.env</code> (por ejemplo a 6) y reinicia el worker.
            </p>
          )}
        </>
      )}
    </>
  );
}
