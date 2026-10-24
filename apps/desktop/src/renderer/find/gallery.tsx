import { Btn, Empty } from "@gratovo/ui";

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
            <div className="row">
              <span className="small ink2">
                <b className="num">{total}</b> {text.channels(total)}
              </span>
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
