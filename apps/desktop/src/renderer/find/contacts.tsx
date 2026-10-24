import { emptyFindFilter, formatCount, type CatalogItem } from "@gratovo/core/find";
import { Btn, Empty } from "@gratovo/ui";
import { useState } from "react";

import { peek } from "../lib/actions";
import { confirmMany } from "../lib/find-actions";
import { useCatalogQuery } from "../lib/find-catalog";
import { go } from "../lib/store";
import { strings } from "../strings";
import { ContactBlock } from "./contact-block";
import { FitChip } from "./fit-chip";
import { ThumbAvatar } from "./thumb";

const text = strings.findContacts;

/** One page of Contacts; "Show more" adds another. */
const pageSize = 40;

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
  const [limit, setLimit] = useState(pageSize);
  const {
    status,
    total: asked,
    items,
  } = useCatalogQuery({
    filter: { ...emptyFindFilter, stages: ["shortlisted"] },
    sort: "fit",
    offset: 0,
    limit,
    facets: false,
  });
  // The page's stage leads the catalog's: a confirmed channel is at Contact and drops out.
  const list = items.filter((i) => i.stage === "shortlisted");
  const total = Math.max(0, asked - (items.length - list.length));
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
  const hasMore = items.length < total;
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
              <FitChip fit={item.fit} />
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
          <span className="small muted">{text.loadedOf(items.length, total)}</span>
          <Btn
            size="sm"
            onClick={() => {
              setLimit(limit + pageSize);
            }}
          >
            {text.showMore}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
