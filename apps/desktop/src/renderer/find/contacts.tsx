import {
  emptyFindFilter,
  fitOf,
  formatCount,
  uploadsUnread,
  type CatalogItem,
} from "@gratovo/core/find";
import { Btn, Empty } from "@gratovo/ui";
import { useEffect, useRef } from "react";

import { peek } from "../lib/actions";
import { emailJobId } from "../lib/email-jobs";
import { confirmMany } from "../lib/find-actions";
import { useCatalogQuery } from "../lib/find-catalog";
import { useGalleryPages } from "../lib/find-gallery-state";
import { go, useApp } from "../lib/store";
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
  // An address a person already confirmed is theirs: Confirm all must not write over it.
  if (item.emailConfirmed) {
    return null;
  }
  const best = item.emails[0];
  return best !== undefined && best.confidence >= sureAt ? best : null;
}

/** How many addresses the Confirm all tooltip lists before "and n more". */
const tipMax = 5;

/** Channels with no address yet (found or confirmed) go after the rest; the order is kept. */
function addressesFirst(list: readonly CatalogItem[]): readonly CatalogItem[] {
  const waiting = (item: CatalogItem): boolean => item.emails.length === 0 && !item.emailConfirmed;
  return [...list.filter((i) => !waiting(i)), ...list.filter(waiting)];
}

/** Where focus goes when cards leave: the next card (by id), or the list header. */
interface Handoff {
  readonly gone: readonly string[];
  readonly next: string | null;
}

/** The first thing a keyboard user can reach inside a card. */
function firstControl(card: Element | null): HTMLElement | null {
  return card?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? null;
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
    moreFailed,
  } = useGalleryPages(shortlisted, "fit");
  // The lookup in the tray: while it runs, a channel with nothing yet is still being searched.
  const lookingNow = useApp((s) => s.ui.jobs.some((j) => j.id === emailJobId && !j.done));
  const ordered = addressesFirst(list);
  const header = useRef<HTMLElement>(null);
  const handoff = useRef<Handoff | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const emptyCard = useRef<HTMLDivElement>(null);
  // A confirmed card leaves the list; focus moves on to its neighbour once it is gone.
  useEffect(() => {
    const h = handoff.current;
    if (h === null || ordered.some((i) => h.gone.includes(i.id))) {
      return;
    }
    handoff.current = null;
    const card =
      h.next === null
        ? null
        : (Array.from(root.current?.querySelectorAll("article") ?? []).find(
            (a) => a.dataset["id"] === h.next,
          ) ?? null);
    (firstControl(card) ?? header.current ?? emptyCard.current)?.focus();
  });
  // With more pages to come the catalog's total stands; at the end the list itself is exact.
  const total = hasMore ? asked : list.length;
  const sure = ordered.flatMap((item) => {
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
      <div className="card" tabIndex={-1} ref={emptyCard}>
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
  const ids = ordered.map((i) => i.id);
  const leave = (id: string): void => {
    const at = ordered.findIndex((i) => i.id === id);
    handoff.current = {
      gone: [id],
      next: ordered[at + 1]?.id ?? ordered[at - 1]?.id ?? null,
    };
  };
  const tipList = sure.map((s) => s.best.email);
  return (
    <div className="col" role="region" aria-label={text.listLabel} ref={root}>
      <div className="row wrap">
        <span className="ink2" tabIndex={-1} ref={header}>
          {text.header(total)}
        </span>
        <span className="sp"></span>
        {sure.length === 0 ? null : (
          <Btn
            kind="pri"
            icon="check"
            tip={
              tipList.length > tipMax
                ? [...tipList.slice(0, tipMax), text.andMore(tipList.length - tipMax)].join(", ")
                : tipList.join(", ")
            }
            onClick={() => {
              handoff.current = { gone: sure.map((s) => s.item.id), next: null };
              const ok = confirmMany(
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
              if (!ok) {
                handoff.current = null;
              }
            }}
          >
            {text.confirmAll(sure.length)}
          </Btn>
        )}
      </div>
      <div className="grid2 ct-grid">
        {ordered.map((item) => (
          <article key={item.id} data-id={item.id} className="card ct-card" aria-label={item.name}>
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
                  ·{" "}
                  {uploadsUnread(item)
                    ? item.readFailed
                      ? strings.unread.failed.label
                      : strings.unread.label
                    : text.median(formatCount(item.medianViews))}
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
            <ContactBlock
              item={item}
              looking={lookingNow && item.emails.length === 0 && !item.emailConfirmed}
              onDone={() => {
                leave(item.id);
              }}
            />
          </article>
        ))}
      </div>
      {hasMore ? (
        <div className="row" style={{ justifyContent: "center" }}>
          <span className="small muted">{text.loadedOf(list.length, total)}</span>
          <Btn size="sm" onClick={loadMore}>
            {moreFailed ? text.moreFailed : text.showMore}
          </Btn>
        </div>
      ) : null}
    </div>
  );
}
