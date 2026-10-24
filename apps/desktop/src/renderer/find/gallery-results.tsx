import type { RejectReason } from "@gratovo/core/data";
import type { CatalogItem } from "@gratovo/core/find";
import { Btn } from "@gratovo/ui";
import { useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";

import { peek } from "../lib/actions";
import { reject, shortlist } from "../lib/find-actions";
import type { GalleryShow, GallerySize, GallerySort, GalleryView } from "../lib/find-gallery-state";
import type { FindSelection } from "../lib/find-selection";
import { strings } from "../strings";
import { BulkBar } from "./bulk-bar";
import { GalleryCard } from "./gallery-card";
import { GalleryTable } from "./gallery-table";

const text = strings.findGallery;

/** The card width for each size, as the prototype has it. */
const cardWidth = { s: "210px", m: "260px", l: "330px" } as const;

export interface GalleryResultsProps {
  readonly items: readonly CatalogItem[];
  readonly view: GalleryView;
  readonly size: GallerySize;
  readonly show: GalleryShow;
  readonly sort: GallerySort;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly total: number;
  readonly selection: FindSelection;
}

/**
 * The channels found, as cards or a table, with the bulk bar while some are selected. The last
 * item asks for the next page when it scrolls into view, and "Show more" does the same by hand.
 */
export function GalleryResults({
  items,
  view,
  size,
  show,
  sort,
  hasMore,
  loadMore,
  total,
  selection,
}: GalleryResultsProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const count = items.length;
  useEffect(() => {
    const node = sentinel.current;
    if (!hasMore || node === null || typeof IntersectionObserver === "undefined") {
      return;
    }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        loadMore();
      }
    });
    watch.observe(node);
    return () => {
      watch.disconnect();
    };
  }, [hasMore, count, loadMore]);

  // The ids in display order, for the peek's Alt+arrow stepping. A ref keeps `open` stable so the
  // memoised cards don't redraw when a page loads.
  const order = useMemo(() => items.map((i) => i.id), [items]);
  const orderRef = useRef(order);
  useEffect(() => {
    orderRef.current = order;
  });
  const open = useCallback((id: string): void => {
    peek({ kind: "creator", id }, orderRef.current);
  }, []);
  const { pick } = selection;
  const onPick = useCallback(
    (id: string, shiftKey: boolean): void => {
      pick(id, { shiftKey });
    },
    [pick],
  );

  const chosen = items.filter((i) => selection.ids.has(i.id));
  const done = (): void => {
    selection.clear();
  };
  return (
    <>
      {view === "table" ? (
        <GalleryTable
          items={items}
          sort={sort}
          selected={selection.ids}
          onOpen={open}
          onPick={onPick}
        />
      ) : (
        <div
          className={selection.count > 0 ? "gal selecting" : "gal"}
          style={{ "--card-w": cardWidth[size] } as CSSProperties}
          role="list"
          aria-label={text.resultsLabel}
        >
          {items.map((item) => (
            <GalleryCard
              key={item.id}
              item={item}
              selected={selection.ids.has(item.id)}
              pics={show.pics}
              latest={show.latest}
              signals={show.signals}
              onOpen={open}
              onPick={onPick}
            />
          ))}
        </div>
      )}
      <div ref={sentinel} aria-hidden="true" style={{ height: 1 }} />
      {hasMore ? (
        <div className="row" style={{ justifyContent: "center" }}>
          <span className="small muted">{text.loadedOf(count, total)}</span>
          <Btn size="sm" onClick={loadMore}>
            {text.showMore}
          </Btn>
        </div>
      ) : null}
      {chosen.length > 0 ? (
        <BulkBar
          items={chosen}
          onShortlist={(list) => {
            shortlist(list);
            done();
          }}
          onReject={(list, reason: RejectReason) => {
            reject(list, reason);
            done();
          }}
          onCompare={selection.openCompare}
          onClear={done}
        />
      ) : null}
    </>
  );
}
