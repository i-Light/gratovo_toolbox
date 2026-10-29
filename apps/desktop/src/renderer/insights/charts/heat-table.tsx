import { toneStyle, type Tone } from "./tone";
import "./charts.css";

export interface HeatTableProps {
  rowLabels: readonly string[];
  colLabels: readonly string[];
  /** cells[row][col]: a share 0..1, or null when not known. */
  cells: readonly (readonly (number | null)[])[];
  format: (v: number) => string;
  /** Text shown for a null cell (default an en dash). */
  nullText?: string;
  tone?: Tone;
  cornerLabel?: string;
  ariaLabel?: string;
}

export function HeatTable({
  rowLabels,
  colLabels,
  cells,
  format,
  nullText = "–",
  tone = "series-live",
  cornerLabel,
  ariaLabel,
}: HeatTableProps) {
  const known = cells.flat().filter((v): v is number => v !== null);
  const min = known.length > 0 ? Math.min(...known) : 0;
  const max = known.length > 0 ? Math.max(...known) : 0;
  const level = (v: number): number => (max === min ? 0.5 : (v - min) / (max - min));

  return (
    <table className="ch-heat" aria-label={ariaLabel} style={toneStyle(tone)}>
      <thead>
        <tr>
          <th scope="col">{cornerLabel ?? ""}</th>
          {colLabels.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowLabels.map((r, ri) => (
          <tr key={r}>
            <th scope="row">{r}</th>
            {colLabels.map((c, ci) => {
              const v = cells[ri]?.[ci] ?? null;
              return (
                <td key={c} className={v === null ? "ch-heat__cell is-null" : "ch-heat__cell"}>
                  {v === null ? null : (
                    <span
                      className="ch-heat__shade"
                      data-heat={level(v).toFixed(3)}
                      style={{ opacity: 0.12 + level(v) * 0.6 }}
                    />
                  )}
                  <span className="ch-heat__text">{v === null ? nullText : format(v)}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
