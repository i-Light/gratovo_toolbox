import { formatCount, type FindFilter } from "@gratovo/core/find";
import { Btn, Icon } from "@gratovo/ui";
import { useMemo } from "react";

import {
  clearFilter,
  filterIsActive,
  patchGalleryFilter,
  setGalleryFilter,
  toggleIn,
  runLabels,
} from "../lib/find-gallery-state";
import { strings } from "../strings";
import { SavedViews } from "./saved-views";

const text = strings.findGallery;

interface ActiveChip {
  readonly key: string;
  readonly label: string;
  readonly remove: () => void;
}

/** One removable chip for each thing the filter narrows by. */
export function activeChips(
  f: FindFilter,
  runLabels: ReadonlyMap<number, string>,
): readonly ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const stage of f.stages) {
    chips.push({
      key: `stage:${stage}`,
      label: strings.record.stages[stage],
      remove: () => {
        patchGalleryFilter({ stages: toggleIn(f.stages, stage) });
      },
    });
  }
  for (const signal of f.signals) {
    chips.push({
      key: `signal:${signal}`,
      label: text.signals[signal],
      remove: () => {
        patchGalleryFilter({ signals: toggleIn(f.signals, signal) });
      },
    });
  }
  if (f.countries.length > 0) {
    chips.push({
      key: "countries",
      label: text.chips.country(f.countries.join(text.chips.or)),
      remove: () => {
        patchGalleryFilter({ countries: [] });
      },
    });
  }
  if (f.minMedian > 0) {
    chips.push({
      key: "min-median",
      label: text.chips.median(formatCount(f.minMedian)),
      remove: () => {
        patchGalleryFilter({ minMedian: 0 });
      },
    });
  }
  if (f.maxMedian !== null) {
    chips.push({
      key: "max-median",
      label: text.chips.medianMax(formatCount(f.maxMedian)),
      remove: () => {
        patchGalleryFilter({ maxMedian: null });
      },
    });
  }
  if (f.minUploads > 0) {
    chips.push({
      key: "uploads",
      label: text.chips.uploads(f.minUploads),
      remove: () => {
        patchGalleryFilter({ minUploads: 0 });
      },
    });
  }
  for (const run of f.runs) {
    chips.push({
      key: `run:${String(run)}`,
      label: runLabels.get(run) ?? text.chips.run(run),
      remove: () => {
        patchGalleryFilter({ runs: toggleIn(f.runs, run) });
      },
    });
  }
  if (f.q !== "") {
    chips.push({
      key: "q",
      label: text.chips.query(f.q),
      remove: () => {
        patchGalleryFilter({ q: "" });
      },
    });
  }
  return chips;
}

/** The active filters as chips you can remove, "Clear all", and the saved views. */
export function GalleryChips({
  filter,
  runs,
}: {
  readonly filter: FindFilter;
  readonly runs: readonly { readonly id: number; readonly startedAt: number }[];
}) {
  const labels = useMemo(() => runLabels(runs), [runs]);
  const chips = activeChips(filter, labels);
  const active = filterIsActive(filter);
  return (
    <div
      className="row wrap gal-chips"
      data-ui="find.gallery.chips"
      role="group"
      aria-label={text.chips.group}
    >
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          className="chip"
          aria-pressed="true"
          aria-label={text.chips.remove(c.label)}
          onClick={c.remove}
        >
          <span className="ell chip-t">{c.label}</span>
          <Icon name="x" size={12} />
        </button>
      ))}
      {active ? (
        <Btn kind="ghost" size="sm" onClick={clearFilter}>
          {text.chips.clearAll}
        </Btn>
      ) : (
        <span className="small muted">{text.chips.none}</span>
      )}
      <span className="sp" />
      <SavedViews filter={filter} active={active} onApply={setGalleryFilter} />
    </div>
  );
}
