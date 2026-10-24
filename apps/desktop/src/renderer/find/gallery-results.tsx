import type { CatalogItem } from "@gratovo/core/find";
import { Btn } from "@gratovo/ui";
import { useEffect, useRef } from "react";

import type { GalleryShow, GallerySize, GalleryView } from "../lib/find-gallery-state";
import { strings } from "../strings";

const text = strings.findGallery;

export interface GalleryResultsProps {
  readonly items: readonly CatalogItem[];
  readonly view: GalleryView;
  readonly size: GallerySize;
  readonly show: GalleryShow;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly total: number;
}

/**
 * The channels found. This body is a plain list of names for now; the cards, the table, selection
 * and compare replace it (G2). What stays: the last item asks for the next page when it scrolls
 * into view, and "Show more" does the same by hand.
 */
export function GalleryResults({ items, hasMore, loadMore, total }: GalleryResultsProps) {
  const last = useRef<HTMLLIElement>(null);
  const count = items.length;
  useEffect(() => {
    const node = last.current;
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
  return (
    <>
      <ul className="gal-list" aria-label={text.resultsLabel}>
        {items.map((item, i) => (
          <li key={item.id} ref={i === count - 1 ? last : undefined}>
            {item.name}
          </li>
        ))}
      </ul>
      {hasMore ? (
        <div className="row" style={{ justifyContent: "center" }}>
          <span className="small muted">{text.loadedOf(count, total)}</span>
          <Btn size="sm" onClick={loadMore}>
            {text.showMore}
          </Btn>
        </div>
      ) : null}
    </>
  );
}
