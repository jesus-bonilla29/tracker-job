import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtPct, fmtPeriod } from "../lib/format";
import { LOW_SAMPLE, lastIndexWithValue, yAxisScale, type Selected, type TrendRow } from "../lib/trend";

interface DotArgs {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: TrendRow;
}

interface TooltipArgs {
  active?: boolean;
  payload?: Array<{ payload: TrendRow }>;
}

const color = (slot: number) => `var(--series-${slot})`;

function Tip({ active, payload, selected, interval }: TooltipArgs & { selected: Selected[]; interval: "week" | "month" }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const label = interval === "week" ? `Semana del ${fmtPeriod(row.period, interval)}` : fmtPeriod(row.period, interval);
  return (
    <div className="tooltip num">
      <div className="t-head">{label}</div>
      {selected.map((s) => {
        const d = row.detail[s.name];
        if (!d) return null;
        return (
          <div key={s.name}>
            <div className="t-row">
              <i className="dot" style={{ ["--dot" as string]: color(s.slot) }} aria-hidden="true" />
              {s.name}
              <b>{fmtPct(d.pct)}</b>
            </div>
            <div className="t-sub">
              {d.mentions} de {d.jobs} ofertas{d.jobs < LOW_SAMPLE ? " (pocas: poco fiable)" : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TrendChart({ rows, selected, interval }: { rows: TrendRow[]; selected: Selected[]; interval: "week" | "month" }) {
  const summary = selected.map((s) => s.name).join(", ");
  const y = yAxisScale(rows, selected.map((s) => s.name));
  return (
    <div className="chart-card" role="img" aria-label={`Gráfico de líneas: porcentaje de ofertas que mencionan ${summary}, por ${interval === "week" ? "semana" : "mes"}. Hay una vista de tabla con los mismos datos.`}>
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={rows} margin={{ top: 12, right: 88, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="period"
            tickFormatter={(p: string) => fmtPeriod(p, interval)}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            axisLine={{ stroke: "var(--line-strong)" }}
            tickLine={false}
            interval="preserveStartEnd"
            padding={{ left: 16, right: 8 }}
          />
          <YAxis
            tickFormatter={(v: number) => `${v} %`}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={48}
            domain={[0, y.max]}
            ticks={y.ticks}
          />
          <Tooltip
            cursor={{ stroke: "var(--line-strong)", strokeWidth: 1 }}
            content={(p) => <Tip {...(p as unknown as TooltipArgs)} selected={selected} interval={interval} />}
          />
          {selected.map((s) => {
            const last = lastIndexWithValue(rows, s.name);
            return (
              <Line
                key={s.name}
                type="linear"
                dataKey={s.name}
                stroke={color(s.slot)}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls
                dot={(p: DotArgs) => {
                  const { cx, cy, index = 0, payload } = p;
                  const key = `${s.name}-${index}`;
                  const d = payload?.detail[s.name];
                  if (cx === undefined || cy === undefined || !d) return <g key={key} />;
                  const hollow = d.jobs < LOW_SAMPLE;
                  return (
                    <g key={key}>
                      <circle cx={cx} cy={cy} r={4} fill={hollow ? "var(--surface)" : color(s.slot)} stroke={color(s.slot)} strokeWidth={2} />
                      {index === last && (
                        <text x={cx + 11} y={cy} dy="0.34em" fill="var(--ink-2)" fontSize={13} fontWeight={650}>
                          {s.name}
                        </text>
                      )}
                    </g>
                  );
                }}
                activeDot={{ r: 6, stroke: "var(--surface)", strokeWidth: 2 }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
