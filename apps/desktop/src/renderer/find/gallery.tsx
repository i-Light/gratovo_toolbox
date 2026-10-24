import { Btn, Empty } from "@gratovo/ui";
import { useMemo } from "react";

import { peek } from "../lib/actions";
import { shortlist } from "../lib/find-actions";
import { useFindSelection } from "../lib/find-selection";
import {
  clearFilter,
  filterIsActive,
  useGalleryFilter,
  useGalleryPages,
  useGalleryShow,
  useGallerySize,
  useGallerySort,
  useGalleryView,
} from "../lib/find-gallery-state";
import { strings } from "../strings";
import { Compare } from "./compare";
import { GalleryChips } from "./gallery-chips";
import { GalleryFacets } from "./gallery-facets";
import { GalleryResults } from "./gallery-results";
import { GalleryToolbar } from "./gallery-toolbar";

const text = strings.findGallery;

/** Find › Gallery: the facets on the left; the toolbar, the active filters and the channels on the right. */
export function Gallery() {
  const filter = useGalleryFilter();
  const sort = useGallerySort();
  const view = useGalleryView();
  const size = useGallerySize();
  const show = useGalleryShow();
  const { items, total, facets, status, loadMore, hasMore } = useGalleryPages(filter, sort);
  const selection = useFindSelection(
    useMemo(() => items.map((i) => i.id), [items]),
    status === "ready",
  );
  const compared = selection.comparing ? items.filter((i) => selection.ids.has(i.id)) : [];
  return (
    <div className="gal-wrap">
      <GalleryFacets filter={filter} facets={facets} />
      <div className="col" style={{ minWidth: 0 }}>
        <div className="card tight">
          <GalleryToolbar q={filter.q} sort={sort} view={view} size={size} show={show} />
          <GalleryChips filter={filter} />
        </div>
        {status === "failed" ? (
          <p className="hint" role="alert">
            {text.loadFailed}
          </p>
        ) : status === "loading" ? (
          <p className="hint" role="status">
            {text.loading}
          </p>
        ) : (
          <>
            {compared.length > 0 ? (
              <Compare
                items={compared}
                onShortlist={(item) => {
                  shortlist([item]);
                }}
                onOpen={(item) => {
                  peek(
                    { kind: "creator", id: item.id },
                    compared.map((c) => c.id),
                  );
                }}
                onClose={selection.closeCompare}
              />
            ) : null}
            <div className="row">
              <span className="small ink2">
                <b className="num">{total}</b> {text.channels(total)}
              </span>
              {items.length > 0 ? (
                <Btn size="sm" kind="ghost" onClick={selection.selectAll}>
                  {text.selectShown(items.length)}
                </Btn>
              ) : null}
              {selection.count > 0 ? (
                <Btn size="sm" kind="ghost" onClick={selection.clear}>
                  {text.clearSelection}
                </Btn>
              ) : null}
            </div>
            {items.length === 0 ? (
              <div className="card">
                <Empty icon="filter" title={text.emptyTitle}>
                  {text.emptyHint}
                </Empty>
                {filterIsActive(filter) ? (
                  <div className="row" style={{ justifyContent: "center" }}>
                    <Btn onClick={clearFilter}>{text.clearFilters}</Btn>
                  </div>
                ) : null}
              </div>
            ) : (
              <GalleryResults
                items={items}
                view={view}
                size={size}
                show={show}
                sort={sort}
                selection={selection}
                hasMore={hasMore}
                loadMore={loadMore}
                total={total}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
