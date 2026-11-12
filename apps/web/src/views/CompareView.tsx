import { useEffect } from "react";
import { useCompare, useOverview } from "../api/hooks";
import { EmptyState, ErrorState, Segmented } from "../components/ui";
import { fmtInt, fmtPct, fmtPp, sourceColor, sourceLabel } from "../lib/format";
import { buildCompareRows, type CompareRow } from "../lib/insights";
import { useParam } from "../lib/useParam";

function Side(props: { source: string; rows: CompareRow[]; max: number; versus: string; side: "a" | "b" }) {
  const { source, rows, max, versus, side } = props;
  return (
    <section className="side" style={{ ["--bar" as string]: sourceColor(source) } as React.CSSProperties} aria-labelledby={`side-${side}`}>
      <h2 id={`side-${side}`}>
        <i className="dot" style={{ ["--dot" as string]: sourceColor(source) }} aria-hidden="true" />
        Más típico de {sourceLabel(source)}
      </h2>
      <p className="sub">Tecnologías que pesan más aquí que en {sourceLabel(versus)}.</p>
      {rows.length === 0 ? (
        <p className="empty-side">Ninguna destaca con las menciones mínimas.</p>
      ) : (
        <ul className="diffs num">
          {rows.map((r) => {
            const own = side === "a" ? r.pctA : r.pctB;
            const other = side === "a" ? r.pctB : r.pctA;
            return (
              <li key={r.name} className={r.noise ? "noise" : undefined}>
                <span className="n">{r.name}</span>
                <span className="v">
                  {fmtPp(r.size)}
                  {r.noise && <span className="sr-only"> (dentro del margen de ruido)</span>}
                </span>
                <div className="track" aria-hidden="true">
                  <div className="fill" style={{ width: `${(r.size / max) * 100}%` }} />
                </div>
                <span className="detail">
                  <span>{fmtPct(own)} en {sourceLabel(source)}</span>
                  <span>{fmtPct(other)} en {sourceLabel(versus)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function CompareView() {
  const overview = useOverview();
  const sources = overview.data?.sources.map((s) => s.source) ?? [];

  const [a, setA] = useParam("a", "");
  const [b, setB] = useParam("b", "");

  // Valores por defecto: Hacker News frente a Arbeitnow si existen; si no, las dos primeras fuentes.
  const defA = sources.includes("hn") ? "hn" : (sources[0] ?? "");
  const defB = sources.includes("arbeitnow") ? "arbeitnow" : (sources.find((s) => s !== defA) ?? "");
  const srcA = a || defA;
  const srcB = b || defB;

  const cmp = useCompare(srcA, srcB);
  useEffect(() => {
    // si la URL trae la misma fuente dos veces, la segunda se cambia por otra distinta
    if (srcA && srcA === srcB) setB(sources.find((s) => s !== srcA));
  }, [srcA, srcB, sources, setB]);

  const optionsFor = (other: string) =>
    sources.map((s) => ({ value: s, label: sourceLabel(s), color: sourceColor(s) })).filter((o) => o.value !== other);

  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;

  const rows = cmp.data ? buildCompareRows(cmp.data) : null;
  const max = rows ? Math.max(1, ...rows.left.map((r) => r.size), ...rows.right.map((r) => r.size)) : 1;

  return (
    <>
      <div className="page-head plain">
        <h1>
          {srcA && srcB ? `Qué piden más en ${sourceLabel(srcA)} que en ${sourceLabel(srcB)}, y al revés` : "Comparar dos fuentes"}
        </h1>
        <p className="lede">
          Cada tecnología se expresa como porcentaje de las ofertas de tecnología de su fuente, así que el tamaño de cada fuente no distorsiona
          la comparación. La barra mide la diferencia en puntos porcentuales (pp).
        </p>
      </div>

      {sources.length < 2 ? (
        <EmptyState title="Hacen falta al menos dos fuentes con ofertas">Cuando el worker termine de cargar otra fuente, podrás compararlas aquí.</EmptyState>
      ) : (
        <>
          <div className="controls">
            <Segmented label="Fuente A" name="a" value={srcA} options={optionsFor(srcB)} onChange={setA} />
            <Segmented label="Fuente B" name="b" value={srcB} options={optionsFor(srcA)} onChange={setB} />
          </div>

          {cmp.isError ? (
            <ErrorState error={cmp.error} onRetry={() => void cmp.refetch()} />
          ) : !cmp.data || !rows ? (
            <p className="foot-note" aria-busy="true">Cargando…</p>
          ) : (
            <>
              <div className="notice num">
                <strong>Cómo leer esto.</strong> {sourceLabel(cmp.data.a.source)} aporta {fmtInt(cmp.data.a.techJobs)} ofertas de tecnología y{" "}
                {sourceLabel(cmp.data.b.source)} {fmtInt(cmp.data.b.techJobs)}. Con esos tamaños, una diferencia menor de unos{" "}
                <strong>{Number.isFinite(rows.margin) ? Math.round(rows.margin) : "—"} pp</strong> no se distingue del azar: sus barras salen
                atenuadas. Además, cada fuente redacta distinto (los anuncios de Hacker News son cortos y listan el stack; los de Arbeitnow son
                largos y mencionan procesos), así que parte de la diferencia es estilo del anuncio y no demanda.
              </div>
              <div className="compare">
                <Side source={cmp.data.a.source} rows={rows.left} max={max} versus={cmp.data.b.source} side="a" />
                <Side source={cmp.data.b.source} rows={rows.right} max={max} versus={cmp.data.a.source} side="b" />
              </div>
              <p className="swatch-note">
                <i aria-hidden="true" /> Barra atenuada: diferencia dentro del margen de ruido
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
