import { emptyFindFilter, isGold } from "@gratovo/core/find";
import type { RejectReason } from "@gratovo/core/data";
import { Btn, Empty } from "@gratovo/ui";
import { useEffect, useMemo, useState } from "react";

import { openRecord } from "../lib/actions";
import { setGalleryFilter } from "../lib/find-gallery-state";
import { ensureCreators, neverContact, reject, shortlist } from "../lib/find-actions";
import { useCatalogQuery } from "../lib/find-catalog";
import { useKeys } from "../lib/keys";
import { go, useApp } from "../lib/store";
import { strings } from "../strings";
import { rejectReasons, TriageCard, type TriageItem } from "./triage-card";

const text = strings.findTriage;

/** One page of Review new. */
const pageSize = 40;

/**
 * "Review results": the newest run opens Review new; an older one opens the gallery filtered to that
 * run (D26), since the gallery's filter carries the run.
 */
export function reviewResults(run: number | null): void {
  if (run === null) {
    go("find", "triage");
    return;
  }
  setGalleryFilter({ ...emptyFindFilter, runs: [run] });
  go("find", "gallery");
}

/** The channels Review new asks main for: one page at a time. */
const reviewSort = "triage" as const;

/** What the Review new tab holds: the page it asks for and the answer. */
export interface Review {
  readonly offset: number;
  readonly setOffset: (offset: number) => void;
  readonly query: ReturnType<typeof useCatalogQuery>;
}

/**
 * The one query behind Review new. The tab's count reads its total, so the screen asks once. No
 * facets are asked for: this view shows none.
 */
export function useReview(): Review {
  const [offset, setOffset] = useState(0);
  const query = useCatalogQuery({
    filter: { ...emptyFindFilter, stages: ["new"] },
    sort: reviewSort,
    offset,
    limit: pageSize,
    facets: false,
  });
  return { offset, setOffset, query };
}

/** The Review new count for the tab: all new channels. */
export function reviewTabCount(review: Review): number | null {
  return review.query.status === "ready" ? review.query.total : null;
}

/** The count for the other tabs: one item and no facets, only for its total. */
export function useReviewCount(): number | null {
  const { status, total } = useCatalogQuery({
    filter: { ...emptyFindFilter, stages: ["new"] },
    sort: reviewSort,
    offset: 0,
    limit: 1,
    facets: false,
  });
  return status === "ready" ? total : null;
}

/** Review new: the channels no one has decided on, one at a time. */
export function Triage({ review }: { readonly review: Review }) {
  const { offset, setOffset } = review;
  const { status, total, items } = review.query;
  // Ages ("2 days ago") are read against the time the visit started; a long visit needs no refresh.
  const [now] = useState(() => Date.now());
  const [at, setAt] = useState(0);
  /* The channels decided on this visit. The tally counts the ones now shortlisted or rejected, read
     from the store, so Undo takes its action off the count. */
  const [decided, setDecided] = useState<ReadonlySet<string>>(new Set());
  const creators = useApp((st) => st.data.creators);
  const tally = useMemo(() => {
    const counts = { s: 0, r: 0 };
    for (const c of creators) {
      if (decided.has(c.id)) {
        if (c.stage === "shortlisted") counts.s += 1;
        else if (c.stage === "rejected") counts.r += 1;
      }
    }
    return counts;
  }, [creators, decided]);
  /** The channel whose reason row is open; a different channel starts closed. */
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  // A later page that has run empty (all decided) starts again from the first.
  const pageEmpty = status === "ready" && items.length === 0 && offset > 0 && total > 0;
  useEffect(() => {
    if (pageEmpty) {
      setOffset(0);
    }
  }, [pageEmpty, setOffset]);

  const index = Math.min(at, Math.max(0, items.length - 1));
  const item: TriageItem | undefined = items[index];
  const gold = items.filter(isGold).length;
  const reasonOpen = item !== undefined && reasonFor === item.id;

  const decide = (kind: "s" | RejectReason): void => {
    if (item === undefined) {
      return;
    }
    const done = kind === "s" ? shortlist([item]) : reject([item], kind);
    if (done) {
      setDecided((d) => new Set(d).add(item.id));
    }
    setReasonFor(null);
  };
  /* Past the last loaded channel, Next asks for the next page; Previous stops at the first one. */
  const step = (by: 1 | -1): void => {
    if (items.length === 0) {
      return;
    }
    if (by === -1) {
      setAt(Math.max(0, index - 1));
    } else if (index + 1 < items.length) {
      setAt(index + 1);
    } else if (offset + items.length < total) {
      setOffset(offset + items.length);
      setAt(0);
    }
  };
  const open = (): void => {
    if (item !== undefined) {
      ensureCreators([item]);
      openRecord({ kind: "creator", id: item.id });
    }
  };

  useKeys(
    {
      s: () => {
        decide("s");
      },
      r: () => {
        setReasonFor(item === undefined || reasonOpen ? null : item.id);
      },
      "1": () => {
        decide(rejectReasons[0] ?? "ai");
      },
      "2": () => {
        decide(rejectReasons[1] ?? "views");
      },
      "3": () => {
        decide(rejectReasons[2] ?? "posting");
      },
      "4": () => {
        decide(rejectReasons[3] ?? "audience");
      },
      arrowright: () => {
        step(1);
      },
      j: () => {
        step(1);
      },
      arrowleft: () => {
        step(-1);
      },
      k: () => {
        step(-1);
      },
      o: open,
      escape: () => {
        if (!reasonOpen) {
          return false;
        }
        setReasonFor(null);
        return true;
      },
    },
    { active: item !== undefined },
  );

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
  if (item === undefined) {
    return (
      <div className="tr-view">
        <div className="card">
          <Empty
            icon="checkc"
            title={text.emptyTitle}
            action={
              <Btn
                size="sm"
                onClick={() => {
                  go("find", "search");
                }}
              >
                {text.goSearch}
              </Btn>
            }
          >
            {tally.s + tally.r > 0 ? text.emptyTally(tally.s, tally.r) : text.emptyHint}
          </Empty>
        </div>
      </div>
    );
  }
  return (
    <div className="tr-view" aria-label={text.listLabel}>
      <div className="row wrap">
        <span className="ink2">
          <b className="num">{total}</b> {text.newWord} · <b className="num">{gold}</b>{" "}
          {text.gold(total > pageSize)} · {text.order}
        </span>
      </div>
      <div className="tr-progress">
        <span className="num">
          {text.position(offset + index + 1, Math.max(total, offset + index + 1))}
        </span>
        <span className="meter" style={{ width: 120 }} aria-hidden="true">
          <i style={{ width: `${String((100 * (offset + index + 1)) / Math.max(total, 1))}%` }}></i>
        </span>
        {tally.s + tally.r > 0 ? (
          <span className="small muted">{text.tally(tally.s, tally.r)}</span>
        ) : null}
        <span className="sp"></span>
        <span className="hint">{text.keysHint}</span>
      </div>
      <TriageCard
        key={item.id}
        item={item}
        now={now}
        reasonOpen={reasonOpen}
        onReasonOpen={(openIt) => {
          setReasonFor(openIt ? item.id : null);
        }}
        onShortlist={() => {
          decide("s");
        }}
        onReject={decide}
        onNever={(why) => {
          if (neverContact(item, why)) {
            setReasonFor(null);
          }
        }}
        onOpen={open}
        onPrev={() => {
          step(-1);
        }}
        onNext={() => {
          step(1);
        }}
      />
    </div>
  );
}
