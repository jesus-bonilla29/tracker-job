import { useMemo, useState } from "react";
import { useOverview, useTopSkills } from "../api/hooks";
import { ErrorState, EmptyState, Segmented } from "../components/ui";
import { categoryLabel, fmtInt, fmtPct, sourceColor, sourceLabel } from "../lib/format";
import { categoriesOf, headline } from "../lib/insights";
import { useParam } from "../lib/useParam";

const PAGE = 20;
/** Por debajo de esto, un porcentaje dice muy poco: se avisa en pantalla. */
const FEW_JOBS = 30;

export function RankingView() {
  const [source, setSource] = useParam("fuente", "all");
  const [category, setCategory] = useParam("categoria", "");
  const [shown, setShown] = useState(PAGE);

  const overview = useOverview();
  const top = useTopSkills(source === "all" ? undefined : source);

  const categories = useMemo(() => categoriesOf(top.data?.skills ?? []), [top.data]);
  const rows = useMemo(
    () => (top.data?.skills ?? []).filter((s) => !category || s.category === category),
    [top.data, category],
  );

  const sourceOptions = [
    { value: "all", label: "Todas" },
    ...(overview.data?.sources ?? []).map((s) => ({ value: s.source, label: sourceLabel(s.source), color: sourceColor(s.source) })),
  ];

  if (top.isError) return <ErrorState error={top.error} onRetry={() => void top.refetch()} />;

  const total = top.data?.totalJobs ?? 0;
  const max = rows[0]?.pct ?? 1;
  const barColor = source === "all" ? undefined : sourceColor(source);

  return (
    <>
      <div className="page-head">
        <h1>{top.data ? headline(top.data.skills, total, source === "all" ? undefined : source) : "Cargando las ofertas…"}</h1>
        <p className="lede">
          Qué tecnologías se mencionan más en las ofertas de empleo tecnológico, como porcentaje de esas ofertas.
        </p>
      </div>

      <div className="controls">
        <Segmented
          label="Fuente"
          name="fuente"
          value={source}
          options={sourceOptions}
          onChange={(v) => {
            setSource(v);
            setShown(PAGE);
          }}
        />
      </div>
      {categories.length > 0 && (
        <div className="controls" role="group" aria-label="Categoría">
          <span className="control-label">Categoría</span>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={category === ""} onClick={() => setCategory("")}>
              Todas
            </button>
            {categories.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => { setCategory(c); setShown(PAGE); }}>
                {categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>
      )}

      {top.isPending ? (
        <ol className="rank" aria-label="Cargando" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i}>
              <div className="skeleton" style={{ width: "70%" }} />
              <div className="track" />
            </li>
          ))}
        </ol>
      ) : rows.length === 0 ? (
        <EmptyState title="No hay tecnologías para este filtro">Prueba con otra fuente o categoría. Si acabas de levantar el proyecto, espera a que el worker termine su primera ejecución.</EmptyState>
      ) : (
        <>
          <ol className="rank" style={barColor ? ({ ["--bar" as string]: barColor } as React.CSSProperties) : undefined}>
            {rows.slice(0, shown).map((s) => (
              <li key={s.name}>
                <span className="name">
                  {s.name}
                  {s.category && <span className="cat">{categoryLabel(s.category)}</span>}
                </span>
                <div className="track" role="img" aria-label={`${s.name}: ${fmtPct(s.pct)} de las ofertas`}>
                  <div className="fill" style={{ width: `${(s.pct / max) * 100}%` }} />
                </div>
                <span className="val num">
                  <b>{fmtPct(s.pct)}</b>
                  <small>{fmtInt(s.jobs)} de {fmtInt(total)} ofertas</small>
                </span>
              </li>
            ))}
          </ol>
          {rows.length > shown && (
            <div className="more">
              <button type="button" className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>
                Mostrar más ({rows.length - shown} restantes)
              </button>
            </div>
          )}
          <p className="foot-note num">
            Cada porcentaje es sobre las {fmtInt(total)} ofertas de tecnología{source === "all" ? " de todas las fuentes" : ` de ${sourceLabel(source)}`}.
            Una oferta puede mencionar varias tecnologías, por eso no suman 100 %. La barra más larga ocupa todo el ancho.
          </p>
          {total < FEW_JOBS && (
            <p className="notice" style={{ marginTop: "1rem" }}>
              <strong>Pocas ofertas:</strong> esta selección solo tiene {fmtInt(total)} ofertas de tecnología, así que los porcentajes cambian mucho con cada oferta nueva.
            </p>
          )}
        </>
      )}
    </>
  );
}
