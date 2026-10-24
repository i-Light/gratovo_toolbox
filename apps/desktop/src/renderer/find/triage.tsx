import { emptyFindFilter, isGold, type FindFilter } from "@gratovo/core/find";
import type { RejectReason } from "@gratovo/core/data";
import { Btn, Empty, Tag } from "@gratovo/ui";
import { useState, useSyncExternalStore } from "react";

import { openRecord } from "../lib/actions";
import { ensureCreators, neverContact, reject, shortlist } from "../lib/find-actions";
import { useCatalogQuery, useRuns } from "../lib/find-catalog";
import { useFind } from "../lib/find";
import { useKeys } from "../lib/keys";
import { go } from "../lib/store";
import { strings } from "../strings";
import { rejectReasons, TriageCard, type TriageItem } from "./triage-card";

const text = strings.findTriage;

/** One page of Review new. */
const pageSize = 40;

/* Which search Review new is narrowed to, or null for every new channel. The route has no place for
   an option, so the choice lives here; "Review results" on a run sets it and the chip clears it. */
let reviewRunId: number | null = null;
const reviewListeners = new Set<() => void>();

function subscribeReviewRun(listener: () => void): () => void {
  reviewListeners.add(listener);
  return () => {
    reviewListeners.delete(listener);
  };
}

/** Narrows Review new to one run (or to none) and opens it. */
export function reviewResults(run: number | null): void {
  reviewRunId = run;
  reviewListeners.forEach((listener) => {
    listener();
  });
  go("find", "triage");
}

/** For tests: forget the run filter. */
export function resetReviewRunForTests(): void {
  reviewRunId = null;
}

/** "Oct 24": the day a run started. */
export function shortDate(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The Review new total, for the tab's count. Asks for one item only. */
export function useReviewCount(): number | null {
  const { status, total } = useCatalogQuery({
    filter: { ...emptyFindFilter, stages: ["new"] },
    sort: "triage",
    offset: 0,
    limit: 1,
  });
  return status === "ready" ? total : null;
}

/** Review new: the channels no one has decided on, one at a time. */
export function Triage() {
  const runId = useSyncExternalStore(subscribeReviewRun, () => reviewRunId);
  const filter: FindFilter = {
    ...emptyFindFilter,
    stages: ["new"],
    runs: runId === null ? [] : [runId],
  };
  const { status, total, items } = useCatalogQuery({
    filter,
    sort: "triage",
    offset: 0,
    limit: pageSize,
  });
  const { runs } = useRuns();
  const archiveDays = useFind().state?.rules.archiveDays ?? 7;
  // Ages ("2 days ago") are read against the time the visit started; a long visit needs no refresh.
  const [now] = useState(() => Date.now());
  const [at, setAt] = useState(0);
  const [tally, setTally] = useState({ s: 0, r: 0 });
  /** The channel whose reason row is open; a different channel starts closed. */
  const [reasonFor, setReasonFor] = useState<string | null>(null);

  const index = Math.min(at, Math.max(0, items.length - 1));
  const item: TriageItem | undefined = items[index];
  const gold = items.filter(isGold).length;
  const reasonOpen = item !== undefined && reasonFor === item.id;

  const decide = (kind: "s" | RejectReason): void => {
    if (item === undefined) {
      return;
    }
    if (kind === "s") {
      if (shortlist([item])) {
        setTally((t) => ({ ...t, s: t.s + 1 }));
      }
    } else if (reject([item], kind, archiveDays)) {
      setTally((t) => ({ ...t, r: t.r + 1 }));
    }
    setReasonFor(null);
  };
  const step = (by: 1 | -1): void => {
    if (items.length === 0) {
      return;
    }
    setAt(by === 1 ? (index + 1) % items.length : Math.max(0, index - 1));
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
      k: () => {
        step(1);
      },
      arrowleft: () => {
        step(-1);
      },
      j: () => {
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

  const runStart = runId === null ? undefined : runs.find((r) => r.id === runId)?.startedAt;
  const chip =
    runId === null ? null : (
      <span className="row" style={{ gap: "6px" }}>
        <Tag tone="info" icon="scan">
          {text.runChip(runStart === undefined ? `#${String(runId)}` : shortDate(runStart))}
        </Tag>
        <Btn
          size="sm"
          kind="ghost"
          onClick={() => {
            reviewResults(null);
          }}
        >
          {text.clearRun}
        </Btn>
      </span>
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
        {chip}
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
        <span className="sp"></span>
        {chip}
      </div>
      <div className="tr-progress">
        <span className="num">{text.position(index + 1, total)}</span>
        <span className="meter" style={{ width: 120 }} aria-hidden="true">
          <i style={{ width: `${String((100 * (index + 1)) / Math.max(total, 1))}%` }}></i>
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
