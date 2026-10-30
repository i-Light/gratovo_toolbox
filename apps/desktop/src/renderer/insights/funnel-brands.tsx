import { Empty } from "@gratovo/ui";
import type { BrandFunnel, Drill } from "@gratovo/core/insights";

import { strings } from "../strings";
import { BarList } from "./charts/bars";
import { FunnelTable } from "./funnel-table";
import { Panel } from "./panel";
import {
  brandDropSentence,
  brandHeadline,
  brandLostHeadline,
  brandStepName,
  brandsAreEmpty,
  shareText,
  usualText,
} from "./words/funnel";
import { num, ratioPct } from "./words/format";
import "./tabs.css";

const t = strings.insights.funnel.brandFunnel;
const fmt = strings.insights.overview.fmt;

/** Funnel › Brands: Found to Paid with the creator funnel's columns, and the brands lost on the way. */
export function BrandsView({
  brands,
  onDrill,
}: {
  readonly brands: BrandFunnel;
  readonly onDrill: (drill: Drill) => void;
}) {
  if (brandsAreEmpty(brands)) {
    return (
      <div className="card" data-ui="insights.funnel.brands.empty">
        <Empty icon="chart" title={t.empty.title}>
          {t.empty.body}
        </Empty>
      </div>
    );
  }
  // Replied and negotiating share their time (a brand's status has no state between them), so the
  // usual time at Replied can't be told from the next step's: it shows a dash, not "0 days".
  const rows = brands.rows.map((r) => (r.step === "replied" ? { ...r, medianDays: null } : r));
  const lost = brands.lost.filter((l) => l.count > 0);
  return (
    <div className="ins-brands" data-ui="insights.funnel.brands">
      <Panel
        dataUi="insights.funnel.brands.table"
        hero
        headline={brandHeadline(brands)}
        counted={t.counted}
        what={t.what}
        numbers={{
          columns: strings.insights.funnel.table.columns,
          rows: rows.map((r) => [
            brandStepName(r.step),
            r.count,
            r.fromPrev === null ? strings.insights.funnel.table.start : shareText(r),
            r.before === null ? fmt.dash : ratioPct(r.before),
            usualText(r.medianDays),
            r.stuck ?? fmt.dash,
          ]),
        }}
        meaning={brandDropSentence(brands)}
      >
        <FunnelTable
          rows={rows}
          biggest={brands.biggestDrop}
          label={t.label}
          dataUi="insights.funnel.brands.row"
          nameOf={brandStepName}
          rowOpen={t.rowOpen}
          stuckOpen={t.stuckOpen}
          onRow={(step) => {
            onDrill({ kind: "brandStep", step });
          }}
          onStuck={(step) => {
            onDrill({ kind: "brandStuck", step });
          }}
        />
      </Panel>
      <Panel
        dataUi="insights.funnel.brands.lost"
        headline={brandLostHeadline(brands)}
        counted={t.lostCounted}
        numbers={{
          columns: t.lostColumns,
          rows: lost.map((l) => [brandStepName(l.step), l.count]),
        }}
      >
        {lost.length === 0 ? null : (
          <BarList
            ariaLabel={t.lostLabel}
            tone="series-neutral"
            rows={lost.map((l, i) => ({
              key: l.step,
              label: brandStepName(l.step),
              value: l.count,
              display: num(l.count),
              ...(i === 0 && lost.length > 1 ? { tone: "warn" as const } : {}),
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
