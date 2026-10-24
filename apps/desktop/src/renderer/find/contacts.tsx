import { emptyFindFilter, fitOf, formatCount, type CatalogItem } from "@gratovo/core/find";
import { Btn, Empty } from "@gratovo/ui";

import { peek } from "../lib/actions";
import { confirmMany } from "../lib/find-actions";
import { useCatalogQuery } from "../lib/find-catalog";
import { useGalleryPages } from "../lib/find-gallery-state";
import { go } from "../lib/store";
import { strings } from "../strings";
import { ContactBlock } from "./contact-block";
import { FitChip } from "./fit-chip";
import { ThumbAvatar } from "./thumb";

const text = strings.findContacts;

const shortlisted = { ...emptyFindFilter, stages: ["shortlisted" as const] };

/** The count for the tab: one item and no facets, only for its total. */
export function useContactsCount(): number | null {
  const { status, total } = useCatalogQuery({
    filter: shortlisted,
    sort: "fit",
    offset: 0,
    limit: 1,
    facets: false,
  });
  return status === "ready" ? total : null;
}

/** The address worth confirming without a look: the best one, when it is at least this sure. */
export const sureAt = 0.9;

/** The best address of a channel when it is sure enough (the list is most sure first). */
function sureAddress(item: CatalogItem) {
  const best = item.emails[0];
  return best !== undefined && best.confidence >= sureAt ? best : null;
}

/**
 * Find › Contacts: the shortlisted channels, each with its found addresses to pick from and
 * confirm, and one button for all the sure ones (D32). A confirmed channel leaves the list.
 */
export function Contacts() {
  // Pages of 120, the most main answers at once. The page's own stage leads the catalog's: a
  // confirmed channel is at Contact and drops out of the list.
  const {
    status,
    items: list,
    total: asked,
    hasMore,
    loadMore,
  } = useGalleryPages(shortlisted, "fit");
  // With more pages to come the catalog's total stands; at the end the list itself is exact.
  const total = hasMore ? asked : list.length;
  const sure = list.flatMap((item) => {
    const best = sureAddress(item);
    return best === null ? [] : [{ item, best }];
  });
  if (status === "failed") {
    return (
      <div className="card">
        <Empty icon="alert" title={text.loadFailed} />
      </div>
    );
  }
  if (status === "loading") {
    return null;
  }
  if (total === 0) {
    return (
      <div className="card">
        <Empty
          icon="at"
          title={text.emptyTitle}
          action={
            <Btn
              size="sm"
              icon="scan"
              onClick={() => {
                go("find", "triage");
              }}
            >
              {text.goReview}
            </Btn>
          }
        >
          {text.emptyHint}
        </Empty>
      </div>
    );
  }
  const ids = list.map((i) => i.id);
  return (
    <div className="col" aria-label={text.listLabel}>
      <div className="row wrap">
        <span className="ink2">{text.header(total)}</span>
        <span className="sp"></span>
        {sure.length === 0 ? null : (
          <Btn
            kind="pri"
            icon="check"
            tip={sure.map((s) => s.best.email).join(", ")}
            onClick={() => {
              confirmMany(
                sure.map(({ item, best }) => ({
                  item,
                  choice: {
                    email: best.email,
                    contactName: "",
                    source: best.source,
                    confidence: best.confidence,
                  },
                })),
              );
            }}
          >
            {text.confirmAll(sure.length)}
          </Btn>
        )}
      </div>
      <div className="grid2 ct-grid">
        {list.map((item) => (
          <article key={item.id} className="card ct-card" aria-label={item.name}>
            <div className="row">
              <ThumbAvatar
                pic={item.pic}
                name={item.name}
                alt={strings.findTriage.picture(item.name)}
              />
              <div className="grow col t2">
                <b className="ct-name">{item.name}</b>
                <span className="small muted ct-meta">
                  {item.handle} ·{" "}
                  {item.subscribers === null
                    ? strings.findTriage.subscribersHidden
                    : text.subscribers(formatCount(item.subscribers))}{" "}
                  · {text.median(formatCount(item.medianViews))}
                </span>
              </div>
              <FitChip fit={fitOf(item)} />
              <Btn
                size="sm"
                kind="ghost"
                icon="eye"
                onClick={() => {
                  peek({ kind: "creator", id: item.id }, ids);
                }}
              >
                {text.open}
              </Btn>
            </div>
            <ContactBlock item={item} />
          </article>
        ))}
      </div>
      {hasMore ? (
        <div className="row" style={{ justifyContent: "center" }}>
          <span className="small muted">{text.loadedOf(list.length, total)}</span>
          <Btn size="sm" onClick={loadMore}>
            {text.showMore}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
