import type { CreatorStage } from "@gratovo/core/data";
import { findSignals, type Facets, type FindFilter } from "@gratovo/core/find";
import { Icon } from "@gratovo/ui";
import type { ReactNode } from "react";

import { useRuns } from "../lib/find-catalog";
import { patchGalleryFilter, runLabel, toggleIn } from "../lib/find-gallery-state";
import { strings } from "../strings";

const text = strings.findGallery;

/** The stages in the order the prototype lists them (Parked before Rejected). */
const stageOrder: readonly CreatorStage[] = [
  "new",
  "shortlisted",
  "contact",
  "emailed",
  "replied",
  "kit",
  "audience",
  "signed",
  "parked",
  "rejected",
  "never",
];

/** How many countries the facet lists before the rest; the ones already chosen always show. */
const countriesShown = 8;

function Facet({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <div className="facet" role="group" aria-label={title}>
      <h4>{title}</h4>
      {children}
    </div>
  );
}

/** One option with a box and a count. An option that would show nothing is off, unless it is on. */
function Opt({
  on,
  label,
  n,
  tip,
  onClick,
}: {
  readonly on: boolean;
  readonly label: string;
  readonly n: number;
  readonly tip?: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="fopt"
      aria-pressed={on}
      onClick={onClick}
      disabled={!on && n === 0}
      {...(tip === undefined ? {} : { "data-tip": tip })}
    >
      <span className="bx">
        <Icon name="check" size={11} />
      </span>
      <span className="ell">{label}</span>
      <span className="c">{n}</span>
    </button>
  );
}

/** The country codes to show: the top few by count, then any chosen one that fell outside them. */
export function countryOptions(
  counts: Readonly<Record<string, number>>,
  chosen: readonly string[],
): string[] {
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, countriesShown)
    .map(([code]) => code);
  return [...top, ...chosen.filter((code) => !top.includes(code))];
}

/** The filters beside the results (D20): each shows how many channels it would leave. */
export function GalleryFacets({
  filter,
  facets,
}: {
  readonly filter: FindFilter;
  readonly facets: Facets;
}) {
  const { runs } = useRuns();
  const now = new Date();
  // Only runs that kept something, newest first; a run already chosen stays so it can be unchosen.
  const shownRuns = runs
    .filter((r) => r.kept > 0 || filter.runs.includes(r.id) || (facets.runs[String(r.id)] ?? 0) > 0)
    .sort((a, b) => b.startedAt - a.startedAt);
  const countries = countryOptions(facets.countries, filter.countries);
  return (
    <aside className="facets" aria-label={text.filtersLabel}>
      <Facet title={text.facets.stage}>
        {stageOrder.map((stage) => (
          <Opt
            key={stage}
            on={filter.stages.includes(stage)}
            label={strings.record.stages[stage]}
            n={facets.stages[stage]}
            onClick={() => {
              patchGalleryFilter({ stages: toggleIn(filter.stages, stage) });
            }}
          />
        ))}
      </Facet>
      <Facet title={text.facets.signals}>
        {findSignals.map((signal) => (
          <Opt
            key={signal}
            on={filter.signals.includes(signal)}
            label={text.signals[signal]}
            n={facets.signals[signal]}
            {...(signal === "gold" ? { tip: text.goldTip } : {})}
            onClick={() => {
              patchGalleryFilter({ signals: toggleIn(filter.signals, signal) });
            }}
          />
        ))}
      </Facet>
      <Facet title={text.facets.country}>
        <div className="fchips">
          {countries.map((code) => {
            const n = facets.countries[code] ?? 0;
            const on = filter.countries.includes(code);
            return (
              <button
                key={code}
                type="button"
                className="chip"
                aria-pressed={on}
                disabled={!on && n === 0}
                data-tip={text.facets.countryTip(code, n)}
                onClick={() => {
                  patchGalleryFilter({ countries: toggleIn(filter.countries, code) });
                }}
              >
                {code}
                <span className="c">{n}</span>
              </button>
            );
          })}
        </div>
      </Facet>
      <Facet title={text.facets.median}>
        <div className="fchips">
          {text.medianOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={filter.minMedian === value}
              onClick={() => {
                patchGalleryFilter({ minMedian: value });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Facet>
      <Facet title={text.facets.uploads}>
        <div className="fchips">
          {text.uploadOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={filter.minUploads === value}
              onClick={() => {
                patchGalleryFilter({ minUploads: value });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </Facet>
      {shownRuns.length === 0 ? null : (
        <Facet title={text.facets.runs}>
          {shownRuns.map((r) => (
            <Opt
              key={r.id}
              on={filter.runs.includes(r.id)}
              label={runLabel(r.startedAt, now)}
              n={facets.runs[String(r.id)] ?? 0}
              onClick={() => {
                patchGalleryFilter({ runs: toggleIn(filter.runs, r.id) });
              }}
            />
          ))}
        </Facet>
      )}
    </aside>
  );
}
