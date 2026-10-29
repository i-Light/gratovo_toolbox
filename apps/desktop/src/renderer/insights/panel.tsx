import { Btn, IconBtn } from "@gratovo/ui";
import type { Verdict } from "@gratovo/core/insights";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { strings } from "../strings";
import { copyText, toCsv } from "./csv";
import type { Cell } from "./csv";
import { VerdictTag } from "./verdict";

const text = strings.insights;

/** What `Panel` takes. */
export interface PanelProps {
  /** The headline: a sentence, or a big number with words. */
  readonly headline: ReactNode;
  /** The line under it: what was counted. */
  readonly counted: string;
  /** A larger headline (26 to 28 px). */
  readonly hero?: boolean;
  readonly verdict?: Verdict;
  /** Adds the Numbers toggle: the same facts as a table. */
  readonly numbers?: {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly Cell[])[];
  };
  /** Adds a What is this? button with this short explanation. */
  readonly what?: string;
  /** The chart. */
  readonly children?: ReactNode;
  /** The footer sentence. */
  readonly meaning?: ReactNode;
  /** The footer buttons, at most two. */
  readonly actions?: ReactNode;
  readonly dataUi: string;
}

/** The raised panel every Insights chart sits in (design 2a). */
export function Panel({
  headline,
  counted,
  hero = false,
  verdict,
  numbers,
  what,
  children,
  meaning,
  actions,
  dataUi,
}: PanelProps) {
  const [table, setTable] = useState(false);
  const [explained, setExplained] = useState(false);
  const whatId = useId();
  const hasFooter = meaning !== undefined || actions !== undefined;
  return (
    <section className="ins-panel" data-ui={dataUi}>
      <header className="ins-panel-head">
        <div className="ins-panel-title">
          <div className={hero ? "ins-headline hero" : "ins-headline"}>{headline}</div>
          <p className="ins-counted">{counted}</p>
        </div>
        <div className="ins-panel-tools">
          {verdict === undefined ? null : <VerdictTag verdict={verdict} />}
          {what === undefined ? null : (
            <IconBtn
              icon="info"
              label={text.whatIsThis}
              pressed={explained}
              dataUi={`${dataUi}.what`}
              onClick={() => {
                setExplained((v) => !v);
              }}
            />
          )}
          {numbers === undefined ? null : (
            <Btn
              kind="ghost"
              size="sm"
              icon="rows"
              expanded={table}
              onClick={() => {
                setTable((v) => !v);
              }}
            >
              {table ? text.hideNumbers : text.numbers}
            </Btn>
          )}
        </div>
      </header>
      {what !== undefined && explained ? (
        <p className="ins-what" id={whatId} role="note">
          {what}
        </p>
      ) : null}
      <div className="ins-panel-body">
        {numbers !== undefined && table ? (
          <>
            <div className="ins-table-wrap">
              <table className="ins-table">
                <thead>
                  <tr>
                    {numbers.columns.map((c, i) => (
                      <th key={`${c}-${String(i)}`} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {numbers.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, i) => (
                        <td key={i} className={typeof cell === "number" ? "num" : undefined}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ins-table-tools">
              <Btn
                kind="ghost"
                size="sm"
                icon="copy"
                onClick={() => {
                  void copyText(toCsv(numbers.columns, numbers.rows), text.csvCopied);
                }}
              >
                {text.copyCsv}
              </Btn>
            </div>
          </>
        ) : (
          children
        )}
      </div>
      {hasFooter ? (
        <footer className="ins-panel-foot">
          <p className="ins-meaning">{meaning}</p>
          {actions === undefined ? null : <div className="ins-actions">{actions}</div>}
        </footer>
      ) : null}
    </section>
  );
}
