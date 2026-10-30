import type { Ratio } from "@gratovo/core/insights";

import { strings } from "../strings";
import { ShareBar } from "./charts/bars";
import { num, ofText, ratioPct } from "./words/format";
import { shareText, usualText } from "./words/funnel";

const t = strings.insights.funnel;
const fmt = strings.insights.overview.fmt;

/** One row of a funnel table: the creator funnel and the brand funnel have the same columns. */
export interface FunnelTableRow<S extends string> {
  readonly step: S;
  readonly count: number;
  readonly fromPrev: Ratio | null;
  readonly before: Ratio | null;
  readonly medianDays: number | null;
  readonly stuck: number | null;
  readonly byDesign?: boolean;
}

/** What `FunnelTable` takes. */
export interface FunnelTableProps<S extends string> {
  readonly rows: readonly FunnelTableRow<S>[];
  /** The step with the biggest drop. */
  readonly biggest: S | null;
  readonly label: string;
  readonly nameOf: (step: S) => string;
  readonly rowOpen: (name: string) => string;
  readonly stuckOpen: (n: string, name: string) => string;
  readonly onRow: (step: S) => void;
  readonly onStuck: (step: S) => void;
  /** Prefix of each row's `data-ui`. */
  readonly dataUi: string;
}

/** The funnel as a table: count, the share from the step above as a bar, the period before, usual days, stuck. */
export function FunnelTable<S extends string>({
  rows,
  biggest,
  label,
  nameOf,
  rowOpen,
  stuckOpen,
  onRow,
  onStuck,
  dataUi,
}: FunnelTableProps<S>) {
  const h = t.table.columns;
  return (
    <div className="ins-table-wrap">
      <table className="ins-funnel" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{h[0]}</th>
            <th scope="col" className="num">
              {h[1]}
            </th>
            <th scope="col">{h[2]}</th>
            <th scope="col" className="num">
              {h[3]}
            </th>
            <th scope="col" className="num">
              {h[4]}
            </th>
            <th scope="col" className="num">
              {h[5]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isBiggest = row.step === biggest;
            const tone = isBiggest
              ? "warn"
              : row.byDesign === true
                ? "series-archive"
                : "series-live";
            const name = nameOf(row.step);
            return (
              <tr
                key={row.step}
                className={isBiggest ? "is-click is-biggest" : "is-click"}
                data-ui={`${dataUi}.${row.step}`}
                onClick={() => {
                  onRow(row.step);
                }}
              >
                <td className="step">
                  <button type="button" className="ins-step-btn" aria-label={rowOpen(name)}>
                    {name}
                    {row.byDesign === true ? (
                      <span className="ins-tag">{t.table.byDesign}</span>
                    ) : null}
                    {isBiggest ? <span className="ins-tag warn">{t.table.biggest}</span> : null}
                  </button>
                </td>
                <td className="num">{num(row.count)}</td>
                <td className="bar">
                  {row.fromPrev === null ? (
                    <span className="ins-quiet">{t.table.start}</span>
                  ) : (
                    <div className="bar-cell">
                      <ShareBar
                        n={row.fromPrev.n}
                        d={row.fromPrev.d}
                        tone={tone}
                        ariaLabel={`${shareText(row)}, ${ofText(row.fromPrev.n, row.fromPrev.d)}`}
                      />
                      <span>{shareText(row)}</span>
                    </div>
                  )}
                </td>
                <td className="num ins-quiet">
                  {row.before === null ? fmt.dash : ratioPct(row.before)}
                </td>
                <td className="num">{usualText(row.medianDays)}</td>
                <td className="num">
                  {row.stuck === null ? (
                    <span className="ins-quiet">{fmt.dash}</span>
                  ) : row.stuck === 0 ? (
                    <span className="ins-quiet">0</span>
                  ) : (
                    <button
                      type="button"
                      className="ins-stuck"
                      aria-label={stuckOpen(num(row.stuck), name)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onStuck(row.step);
                      }}
                    >
                      {num(row.stuck)}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
