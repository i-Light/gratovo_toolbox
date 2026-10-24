import { fitOf, formatCount, type CatalogItem } from "@gratovo/core/find";
import { Btn, cx, IconBtn } from "@gratovo/ui";
import { useEffect, useMemo, useRef } from "react";

import { strings } from "../strings";
import { Thumb } from "./thumb";

const text = strings.findGallery.compare;

/** More uploads than this in 30 days is Shorts, which don't count as the best (D8). */
const shortsOver = 20;

export interface CompareProps {
  readonly items: readonly CatalogItem[];
  readonly onShortlist: (item: CatalogItem) => void;
  readonly onOpen: (item: CatalogItem) => void;
  readonly onClose: () => void;
}

interface Cell {
  readonly shown: string;
  /** What "best" compares; null never wins. */
  readonly rank: number | null;
}

interface Row {
  readonly label: string;
  readonly cells: readonly Cell[];
  /** False for a row with no better or worse (a country). */
  readonly hasBest: boolean;
}

function rowsOf(items: readonly CatalogItem[]): Row[] {
  const cells = (make: (i: CatalogItem) => Cell): Cell[] => items.map(make);
  return [
    {
      label: text.fit,
      hasBest: true,
      cells: cells((i) => {
        const score = fitOf(i).score;
        return { shown: text.fitValue(score), rank: score };
      }),
    },
    {
      label: text.subscribers,
      hasBest: true,
      cells: cells((i) =>
        i.subscribers === null
          ? { shown: text.hidden, rank: null }
          : { shown: formatCount(i.subscribers), rank: i.subscribers },
      ),
    },
    {
      label: text.median,
      hasBest: true,
      cells: cells((i) => ({ shown: formatCount(i.medianViews), rank: i.medianViews })),
    },
    {
      label: text.uploads,
      hasBest: true,
      cells: cells((i) => {
        const shorts = i.uploads30 > shortsOver;
        return {
          shown: `${String(i.uploads30)}${shorts ? text.shorts : ""}`,
          rank: shorts ? null : i.uploads30,
        };
      }),
    },
    {
      label: text.engagement,
      hasBest: true,
      cells: cells((i) =>
        i.engagement === null
          ? { shown: text.engagementUnknown, rank: null }
          : { shown: text.engagementValue(i.engagement), rank: i.engagement },
      ),
    },
    {
      label: text.country,
      hasBest: false,
      cells: cells((i) => ({ shown: i.country ?? text.unknown, rank: null })),
    },
    {
      label: text.sponsors,
      hasBest: true,
      cells: cells((i) => ({
        shown:
          i.sponsors.length === 0
            ? text.sponsorsNone
            : `${String(i.sponsors.length)}: ${i.sponsors.join(", ")}`,
        rank: i.sponsors.length,
      })),
    },
  ];
}

/** Two to four channels side by side (D22; find.js `Compare`). Scrolls inside its card, not the page. */
export function Compare({ items, onShortlist, onOpen, onClose }: CompareProps) {
  const n = items.length;
  const rows = useMemo(() => rowsOf(items), [items]);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // happy-dom (the tests) has no scrollIntoView.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    top.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  const cols = { gridTemplateColumns: `150px repeat(${String(n)}, minmax(0, 1fr))` };
  return (
    <div className="card cmp-card" ref={top} role="region" aria-label={text.title(n)}>
      <div className="card-h">
        <h3>{text.title(n)}</h3>
        <span className="hint">{text.hint}</span>
        <IconBtn icon="x" label={text.close} onClick={onClose} />
      </div>
      <div className="cmp-scroll">
        <div className="cmp-grid" style={{ minWidth: 150 + n * 190 }}>
          <div className="cmp" style={cols}>
            <span />
            {items.map((i) => (
              <div key={i.id} className="cc">
                <Thumb pic={i.videos[0]?.pic ?? null} alt={i.name} name={i.name} />
                <b className="cmp-name">{i.name}</b>
                <span className="small muted ell">
                  {i.handle} · {strings.record.stages[i.stage]}
                </span>
              </div>
            ))}
          </div>
          {rows.map((row) => {
            const ranks = row.cells.map((c) => c.rank).filter((r): r is number => r !== null);
            const best = ranks.length > 0 ? Math.max(...ranks) : null;
            return (
              <div key={row.label} className="cmp-row" style={cols}>
                <span className="lbl">{row.label}</span>
                {row.cells.map((cell, idx) => (
                  <span
                    key={items[idx]?.id}
                    className={cx(
                      "num",
                      row.hasBest && n > 1 && best !== null && cell.rank === best && "best",
                    )}
                  >
                    {cell.shown}
                  </span>
                ))}
              </div>
            );
          })}
          <div className="cmp-row" style={cols}>
            <span />
            {items.map((i) => (
              <span key={i.id} className="row wrap">
                {i.stage === "new" ? (
                  <Btn
                    size="sm"
                    kind="pri"
                    icon="check"
                    label={text.shortlistName(i.name)}
                    onClick={() => {
                      onShortlist(i);
                    }}
                  >
                    {text.shortlist}
                  </Btn>
                ) : null}
                <Btn
                  size="sm"
                  kind="ghost"
                  icon="eye"
                  label={text.openName(i.name)}
                  onClick={() => {
                    onOpen(i);
                  }}
                >
                  {text.open}
                </Btn>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
