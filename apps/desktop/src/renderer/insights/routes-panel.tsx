import { otherRoutesLabel } from "@gratovo/core/insights";
import type { RouteKind, RouteRow, RoutesReport } from "@gratovo/core/insights";
import { Btn } from "@gratovo/ui";
import { useState } from "react";

import { strings } from "../strings";
import { BarList } from "./charts/bars";
import type { Tone } from "./charts/tone";
import { Panel } from "./panel";
import { fmt, pct } from "./words/search";

const t = strings.insights.search.routes;
const shown = 12;

const tones: Readonly<Record<RouteKind, Tone>> = {
  aws: "series-live",
  proxy: "series-rules",
  free: "series-waiting",
  direct: "series-neutral",
};

type SortKey = "label" | "kind" | "requests" | "blockRate" | "inRangePer100" | "mbPerKeyword";

const labelOf = (r: RouteRow): string =>
  r.label === otherRoutesLabel ? t.otherRoutes[r.kind] : r.label;
const one = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const rate = (v: number | null): string => (v === null ? t.notKnown : pct(v));
const per100 = (v: number | null): string => (v === null ? t.notKnown : one(v));
const mb = (v: number | null): string => (v === null ? t.notKnown : one(v));

function sorted(rows: readonly RouteRow[], key: SortKey, down: boolean): RouteRow[] {
  const sign = down ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    // A value that is not known goes last whichever way the column is sorted.
    if (x === null || y === null) {
      return x === y ? 0 : x === null ? 1 : -1;
    }
    const by =
      typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return by * sign || a.label.localeCompare(b.label);
  });
}

function ByKind({ report }: { readonly report: RoutesReport }) {
  return (
    <BarList
      ariaLabel={t.kindAria}
      rows={report.byKind.map((k) => ({
        key: k.kind,
        label: t.kinds[k.kind],
        value: k.inRangePer100 ?? 0,
        tone: tones[k.kind],
        display: `${per100(k.inRangePer100)} · ${t.kindLine(
          rate(k.blockRate),
          mb(k.mbPerKeyword),
          t.routeCount(String(k.routes)),
        )}`,
      }))}
    />
  );
}

function RouteTable({ rows }: { readonly rows: readonly RouteRow[] }) {
  const [key, setKey] = useState<SortKey>("requests");
  const [down, setDown] = useState(true);
  const [all, setAll] = useState(false);
  const list = sorted(rows, key, down);
  const visible = all ? list : list.slice(0, shown);
  const head = (k: SortKey, numeric: boolean) => (
    <th
      key={k}
      scope="col"
      className={numeric ? "num" : undefined}
      aria-sort={key === k ? (down ? "descending" : "ascending") : "none"}
    >
      <button
        type="button"
        className="srch-link"
        aria-label={t.sortBy(t.columns[k])}
        onClick={() => {
          if (key === k) {
            setDown(!down);
          } else {
            setKey(k);
            setDown(numeric);
          }
        }}
      >
        {t.columns[k]}
        {key === k ? (down ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  return (
    <>
      <div className="ins-table-wrap">
        <table className="ins-table srch-routes" aria-label={t.tableAria}>
          <thead>
            <tr>
              {head("label", false)}
              {head("kind", false)}
              {head("requests", true)}
              {head("blockRate", true)}
              {head("inRangePer100", true)}
              {head("mbPerKeyword", true)}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={`${r.kind}/${r.label}`}>
                <th scope="row">{labelOf(r)}</th>
                <td>{t.kinds[r.kind]}</td>
                <td className="num">{fmt(r.requests)}</td>
                <td className="num">{rate(r.blockRate)}</td>
                <td className="num">{per100(r.inRangePer100)}</td>
                <td className="num">{mb(r.mbPerKeyword)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > shown ? (
        <p className="srch-note">
          <Btn
            kind="ghost"
            size="sm"
            onClick={() => {
              setAll(!all);
            }}
          >
            {all ? t.showFewer : t.showAll(fmt(list.length))}
          </Btn>
        </p>
      ) : null}
    </>
  );
}

/** Search › Routes: how the period's requests left this computer and what each way delivered. */
export function RoutesPanel({
  report,
  dataUi,
}: {
  readonly report: RoutesReport | null;
  readonly dataUi: string;
}) {
  if (report === null || report.routes.length === 0) {
    return (
      <Panel dataUi={dataUi} headline={t.headlineNone} counted={t.counted} what={t.what}>
        <p className="muted" data-ui={`${dataUi}.empty`}>
          {report === null ? t.noData : t.none}
        </p>
      </Panel>
    );
  }
  const best = report.byKind
    .filter((k) => k.inRangePer100 !== null)
    .sort((a, b) => (b.inRangePer100 ?? 0) - (a.inRangePer100 ?? 0))[0];
  const blocked = report.byKind.reduce((s, k) => s + k.blocks, 0);
  const requests = report.byKind.reduce((s, k) => s + k.requests, 0);
  return (
    <Panel
      dataUi={dataUi}
      headline={
        best !== undefined && report.byKind.length > 1
          ? t.headline(t.kinds[best.kind])
          : t.headlineNone
      }
      counted={t.counted}
      what={t.what}
      numbers={{
        columns: t.csvColumns,
        rows: report.routes.map((r) => [
          t.kinds[r.kind],
          labelOf(r),
          r.requests,
          rate(r.blockRate),
          per100(r.inRangePer100),
          mb(r.mbPerKeyword),
        ]),
      }}
      meaning={t.meaning(fmt(blocked), fmt(requests))}
    >
      <ByKind report={report} />
      <RouteTable rows={report.routes} />
    </Panel>
  );
}
