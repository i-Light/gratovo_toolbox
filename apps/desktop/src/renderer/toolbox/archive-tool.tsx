import { formatCount, type ArchivedChannel, type ToolboxItem } from "@gratovo/core/find";
import { Btn, Empty, Icon, cx } from "@gratovo/ui";
import { useEffect, useMemo, useState } from "react";

import { peek } from "../lib/actions";
import { bringBack } from "../lib/find-actions";
import { useFind } from "../lib/find";
import { ago, shortDate } from "../lib/format";
import { restoreForGood, useArchived, useToolboxList } from "../lib/toolbox";
import { strings } from "../strings";
import { ThumbAvatar } from "../find/thumb";

const text = strings.toolbox.archive;
const shared = strings.toolbox;

const dayMs = 86_400_000;
/** How often the countdown looks at the clock again. */
const clockMs = 60_000;
/** The ids main will restore; a tombstone with any other id can't be brought back. */
const channelIdLike = /^UC[A-Za-z0-9_-]{22}$/;
/** The archive window when the rules haven't loaded: the default (plan D6). */
const defaultDays = 7;

/** Whole days until `dueAt`, never below 0; "archived today" covers a date that has passed. */
function daysLeft(dueAt: number, now: number): number {
  return Math.max(0, Math.ceil((dueAt - now) / dayMs));
}

/** The countdown on the right of a row: the words and a meter of the days left, warning at one. */
function Countdown({
  dueAt,
  days,
  now,
}: {
  readonly dueAt: number | null;
  readonly days: number;
  readonly now: number;
}) {
  if (dueAt === null) {
    return (
      <span className="col t2 tb-when">
        <span className="small ink2 num">{text.noDate}</span>
      </span>
    );
  }
  const left = daysLeft(dueAt, now);
  const pct = Math.min(100, Math.round((left / Math.max(1, days)) * 100));
  return (
    <span className="col t2 tb-when">
      <span className="small ink2 num">{left === 0 ? text.today : text.inDays(left)}</span>
      <span
        className={cx("meter", left <= 1 && "warn")}
        role="meter"
        aria-valuenow={left}
        aria-valuemin={0}
        aria-valuemax={days}
        aria-label={text.meterLabel}
      >
        <i style={{ width: `${String(pct)}%` }}></i>
      </span>
    </span>
  );
}

/** One rejected channel with its countdown; the row opens the peek, the button brings it back. */
function CountdownRow({
  item,
  ids,
  days,
  now,
}: {
  readonly item: ToolboxItem;
  readonly ids: readonly string[];
  readonly days: number;
  readonly now: number;
}) {
  const reason =
    item.rejectReason === null
      ? text.reasonUnknown
      : strings.findActions.reasons[item.rejectReason];
  const when = item.rejectedAt === null ? null : ago(item.rejectedAt, now);
  return (
    <div className="row wrap tb-row">
      <button
        type="button"
        className="li"
        onClick={() => {
          peek({ kind: "creator", id: item.id }, ids);
        }}
      >
        <ThumbAvatar pic={item.pic} name={item.name} alt={item.name} />
        <span className="lt">
          <b>{item.name}</b>
          <small>
            {[item.handle, reason, when].filter((x) => x !== null && x !== "").join(" · ")}
          </small>
        </span>
        <Countdown dueAt={item.dueAt} days={days} now={now} />
      </button>
      <Btn
        size="sm"
        icon="undo"
        label={text.bringBackLabel(item.name)}
        onClick={() => {
          bringBack(item);
        }}
      >
        {text.bringBack}
      </Btn>
    </div>
  );
}

/** The label as people read it: the 7-day sweep's `rejected` is a word, any other is as written. */
function labelWords(label: string | null): string | null {
  if (label === null || label === "") {
    return null;
  }
  return label === "rejected" ? text.rejectedLabel : label;
}

/** One tombstone, with Bring back. */
function ArchivedRow({
  row,
  busy,
  onRestore,
}: {
  readonly row: ArchivedChannel;
  readonly busy: boolean;
  readonly onRestore: (row: ArchivedChannel) => void;
}) {
  const title = row.name ?? row.handle ?? text.unknownName;
  const details = [
    row.name === null ? null : row.handle,
    labelWords(row.label),
    row.archivedAt === null ? null : text.archivedOn(shortDate(row.archivedAt)),
    row.subscribers === null ? null : text.subscribers(formatCount(row.subscribers)),
  ].filter((x) => x !== null && x !== "");
  return (
    <div className="row tb-gone">
      <span className="lt grow">
        <b>{title}</b>
        <small className="muted">{details.join(" · ")}</small>
      </span>
      {channelIdLike.test(row.id) ? (
        <Btn
          size="sm"
          icon="undo"
          disabled={busy}
          label={text.bringBackLabel(title)}
          onClick={() => {
            onRestore(row);
          }}
        >
          {text.bringBack}
        </Btn>
      ) : null}
    </div>
  );
}

/** "Archived for good": the tombstones, a search box over them, 50 a page. */
function ArchivedForGood() {
  const [q, setQ] = useState("");
  const archived = useArchived(q);
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const restore = (row: ArchivedChannel): void => {
    setWorking((cur) => new Set(cur).add(row.id));
    void restoreForGood(row).then((outcome) => {
      setWorking((cur) => {
        const next = new Set(cur);
        next.delete(row.id);
        return next;
      });
      if (outcome === "restored") {
        archived.drop([row.id]);
      }
    });
  };
  const searching = archived.asked !== "";
  return (
    <section className="col tight tb-sec" aria-labelledby="tb-gone-h">
      <h3 id="tb-gone-h">{text.forGoodTitle}</h3>
      <p className="hint">{text.forGoodHint}</p>
      <label className="tb-search">
        <Icon name="search" />
        <input
          value={q}
          onChange={(event) => {
            setQ(event.currentTarget.value);
          }}
          placeholder={text.searchPlaceholder}
          aria-label={text.searchLabel}
          maxLength={100}
        />
      </label>
      {archived.status === "failed" ? (
        <Empty icon="alert" title={shared.loadFailed} />
      ) : archived.status === "loading" ? null : archived.items.length === 0 ? (
        <Empty icon="trash" title={searching ? text.noMatch : text.forGoodEmpty} />
      ) : (
        <div className="list" aria-label={text.forGoodTitle}>
          {archived.items.map((row) => (
            <ArchivedRow key={row.id} row={row} busy={working.has(row.id)} onRestore={restore} />
          ))}
        </div>
      )}
      {archived.hasMore ? (
        <div>
          <Btn size="sm" onClick={archived.loadMore}>
            {archived.moreFailed ? shared.moreFailed : shared.showMore}
          </Btn>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Toolbox › Archive (D36): rejected channels with the days left before they are archived for good,
 * then the channels already archived for good. Opening the tool asks main to run the sweep.
 */
export function ArchiveTool() {
  const { state } = useFind();
  const days = state?.rules.archiveDays ?? defaultDays;
  const list = useToolboxList("archive");
  // The countdown is as of when the list was drawn; a rebuild or a change draws it again.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, clockMs);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    window.gratovo.invoke("toolbox:sweep", {}).then(
      () => undefined,
      () => undefined,
    );
  }, []);
  const ids = useMemo(() => list.items.map((i) => i.id), [list.items]);
  return (
    <div className="col">
      {list.status === "failed" ? (
        <Empty icon="alert" title={shared.loadFailed} />
      ) : list.status === "loading" ? null : list.items.length === 0 ? (
        <Empty icon="trash" title={text.emptyTitle}>
          {text.emptyHint(days)}
        </Empty>
      ) : (
        <div className="col tight">
          <p className="hint">{text.hint(days)}</p>
          <div className="col tight">
            {list.items.map((item) => (
              <CountdownRow key={item.id} item={item} ids={ids} days={days} now={now} />
            ))}
          </div>
          {list.hasMore ? (
            <div>
              <Btn size="sm" onClick={list.loadMore}>
                {list.moreFailed ? shared.moreFailed : shared.showMore}
              </Btn>
            </div>
          ) : null}
        </div>
      )}
      <ArchivedForGood />
    </div>
  );
}
