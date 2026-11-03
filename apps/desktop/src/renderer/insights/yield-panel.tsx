import type { YieldReport, YieldRow } from "@gratovo/core/insights";
import { Btn, Seg } from "@gratovo/ui";
import { useState } from "react";

import { strings } from "../strings";
import { Panel } from "./panel";
import { fmt } from "./words/search";

const t = strings.insights.search.yield;
const shown = 8;

type By = "tool" | "angle";

const one = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const per = (r: YieldRow): string => (r.perKeyword === null ? t.notKnown : one(r.perKeyword));
const nameOf = (r: YieldRow): string => (r.name === "" ? t.byHand : r.name);

function Table({
  rows,
  hand,
}: {
  readonly rows: readonly YieldRow[];
  readonly hand: YieldRow | null;
}) {
  const [all, setAll] = useState(false);
  const visible = all ? rows : rows.slice(0, shown);
  const list = hand === null ? visible : [...visible, hand];
  return (
    <>
      <div className="ins-table-wrap">
        <table className="ins-table srch-routes" aria-label={t.tableAria}>
          <thead>
            <tr>
              <th scope="col">{t.columns.name}</th>
              <th scope="col" className="num">
                {t.columns.keywords}
              </th>
              <th scope="col" className="num">
                {t.columns.inRange}
              </th>
              <th scope="col" className="num">
                {t.columns.newFound}
              </th>
              <th scope="col" className="num">
                {t.columns.perKeyword}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.name === "" ? "~hand" : r.name}>
                <th scope="row">{nameOf(r)}</th>
                <td className="num">{fmt(r.keywords)}</td>
                <td className="num">{fmt(r.inRange)}</td>
                <td className="num">{fmt(r.newFound)}</td>
                <td className={r.judged ? "num" : "num muted"}>{r.judged ? per(r) : t.tooFew}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown ? (
        <p className="srch-note">
          <Btn
            kind="ghost"
            size="sm"
            onClick={() => {
              setAll(!all);
            }}
          >
            {all ? t.showFewer : t.showAll(fmt(rows.length))}
          </Btn>
        </p>
      ) : null}
    </>
  );
}

/** Search › Yield: what the period's finished keywords found, by the tool and angle behind them. */
export function YieldPanel({
  report,
  dataUi,
}: {
  readonly report: YieldReport;
  readonly dataUi: string;
}) {
  const [by, setBy] = useState<By>("tool");
  if (report.byTool.length === 0 && report.byAngle.length === 0 && report.byHand === null) {
    return (
      <Panel dataUi={dataUi} headline={t.headlineNone} counted={t.counted} what={t.what}>
        <p className="muted" data-ui={`${dataUi}.empty`}>
          {t.none}
        </p>
      </Panel>
    );
  }
  const rows = by === "tool" ? report.byTool : report.byAngle;
  const best = rows.find((r) => r.judged && r.perKeyword !== null);
  const total = report.byTool.reduce((s, r) => s + r.keywords, 0) + (report.byHand?.keywords ?? 0);
  const inRange = report.byTool.reduce((s, r) => s + r.inRange, 0) + (report.byHand?.inRange ?? 0);
  return (
    <Panel
      dataUi={dataUi}
      headline={best === undefined ? t.headlineNone : t.headline(best.name)}
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: t.csvColumns,
        rows: [
          ...report.byTool.map((r) => [
            t.byTool,
            r.name,
            r.keywords,
            r.inRange,
            r.newFound,
            per(r),
          ]),
          ...report.byAngle.map((r) => [
            t.byAngle,
            r.name,
            r.keywords,
            r.inRange,
            r.newFound,
            per(r),
          ]),
          ...(report.byHand === null
            ? []
            : [
                [
                  t.byHand,
                  t.byHand,
                  report.byHand.keywords,
                  report.byHand.inRange,
                  report.byHand.newFound,
                  per(report.byHand),
                ],
              ]),
        ],
      }}
      meaning={t.meaning(fmt(total), fmt(inRange))}
    >
      <div className="ins-switches">
        <Seg
          label={t.byLabel}
          value={by}
          options={[
            { value: "tool", label: t.byTool },
            { value: "angle", label: t.byAngle },
          ]}
          onPick={(value) => {
            setBy(value === "angle" ? "angle" : "tool");
          }}
        />
      </div>
      <Table rows={rows} hand={report.byHand} />
    </Panel>
  );
}
