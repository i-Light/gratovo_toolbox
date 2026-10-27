import { creatorStages, neverReasonMax } from "@gratovo/core/data";
import { emptyFindFilter, type CatalogItem, type ToolboxItem } from "@gratovo/core/find";
import { Btn, Empty, Icon, Tag } from "@gratovo/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { peek } from "../lib/actions";
import { allowAgain, neverContact } from "../lib/find-actions";
import { ago } from "../lib/format";
import { useApp } from "../lib/store";
import { useToolboxList } from "../lib/toolbox";
import { strings } from "../strings";
import { ThumbAvatar } from "../find/thumb";

const text = strings.toolbox.never;
const shared = strings.toolbox;

/** How long the search waits after the last key before it asks. */
const searchWaitMs = 250;
/** How many channels the search shows. */
const searchLimit = 8;
/** The stages the search offers: every one but the one it adds to. */
const searchStages = creatorStages.filter((s) => s !== "never");

type Search =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly items: readonly CatalogItem[] };

/** The catalog channels matching `q` (best fit first), asked for 250 ms after the last key. */
function useChannelSearch(q: string): Search {
  const asked = q.trim();
  const [answer, setAnswer] = useState<{ readonly key: string; readonly value: Search }>({
    key: "",
    value: { status: "idle" },
  });
  useEffect(() => {
    if (asked === "") {
      return undefined;
    }
    let stopped = false;
    const timer = setTimeout(() => {
      window.gratovo
        .invoke("find:query", {
          filter: { ...emptyFindFilter, stages: searchStages, q: asked },
          sort: "fit",
          offset: 0,
          limit: searchLimit,
          facets: false,
        })
        .then(
          (result) => {
            if (!stopped) {
              setAnswer({
                key: asked,
                value: result.ok
                  ? { status: "ready", items: result.value.items }
                  : { status: "failed" },
              });
            }
          },
          () => {
            if (!stopped) {
              setAnswer({ key: asked, value: { status: "failed" } });
            }
          },
        );
    }, searchWaitMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [asked]);
  if (asked === "") {
    return { status: "idle" };
  }
  return answer.key === asked ? answer.value : { status: "loading" };
}

/** The "Add a channel" card: find a channel, say why (or not), and block it. */
function AddChannel() {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<CatalogItem | null>(null);
  const [why, setWhy] = useState("");
  const found = useChannelSearch(q);
  // The page's own creator state leads main's answer: a channel just blocked is not offered again.
  const creators = useApp((s) => s.data.creators);
  const search = useMemo((): Search => {
    if (found.status !== "ready") {
      return found;
    }
    const mine = new Map(creators.map((c) => [c.id, c.stage]));
    const items = found.items
      .map((i) => ({ ...i, stage: mine.get(i.id) ?? i.stage }))
      .filter((i) => i.stage !== "never");
    return { status: "ready", items };
  }, [found, creators]);
  const add = (): void => {
    if (chosen === null) {
      return;
    }
    neverContact(chosen, why.trim() || text.defaultReason);
    setChosen(null);
    setWhy("");
    setQ("");
  };
  return (
    <section
      className="card flat tight col tight"
      data-ui="toolbox.never.add"
      aria-labelledby="tb-never-add"
    >
      <h4 id="tb-never-add">{text.addTitle}</h4>
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
      {search.status === "idle" ? (
        <p className="hint">{text.searchHint}</p>
      ) : search.status === "loading" ? (
        <p className="hint">{text.searching}</p>
      ) : search.status === "failed" ? (
        <p className="hint">{text.searchFailed}</p>
      ) : search.items.length === 0 ? (
        <p className="hint">{text.noMatch}</p>
      ) : (
        <div className="col tight" role="group" aria-label={text.resultsLabel}>
          {search.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="li"
              aria-pressed={chosen?.id === item.id}
              onClick={() => {
                setChosen(item);
              }}
            >
              <ThumbAvatar pic={item.pic} name={item.name} alt={item.name} />
              <span className="lt">
                <b>{item.name}</b>
                <small>{[item.handle, strings.record.stages[item.stage]].join(" · ")}</small>
              </span>
              {chosen?.id === item.id ? <Icon name="check" /> : null}
            </button>
          ))}
        </div>
      )}
      <div className="row wrap">
        <input
          className="inp tb-why"
          value={why}
          onChange={(event) => {
            setWhy(event.currentTarget.value);
          }}
          placeholder={text.reasonPlaceholder}
          aria-label={text.reasonLabel}
          maxLength={neverReasonMax}
        />
        <Btn icon="ban" disabled={chosen === null} onClick={add}>
          {text.add}
        </Btn>
      </div>
    </section>
  );
}

/** One blocked channel. "Allow again" asks first; Esc backs out of the question. */
function NeverRow({
  item,
  ids,
  now,
}: {
  readonly item: ToolboxItem;
  readonly ids: readonly string[];
  readonly now: number;
}) {
  const [asking, setAsking] = useState(false);
  const allowRef = useRef<HTMLButtonElement>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const backed = useRef(false);
  useEffect(() => {
    if (asking) {
      yesRef.current?.focus();
    } else if (backed.current) {
      backed.current = false;
      allowRef.current?.focus();
    }
  }, [asking]);
  // Esc backs out of the question (and goes no further, so it does not also close the peek).
  useEffect(() => {
    if (!asking) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        backed.current = true;
        setAsking(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
    };
  }, [asking]);
  const reason =
    item.neverReason === null || item.neverReason === "" ? text.noReason : item.neverReason;
  const when = item.rejectedAt === null ? null : ago(item.rejectedAt, now);
  return (
    <div className="row wrap tb-row" data-row={item.id} data-ui="toolbox.never.row">
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
          <small>{[reason, when].filter((x) => x !== null).join(" · ")}</small>
        </span>
        <Tag tone="crit" icon="ban">
          {text.tag}
        </Tag>
      </button>
      {asking ? (
        <span className="row" role="group" aria-label={text.allowLabel(item.name)}>
          <Btn
            size="sm"
            kind="pri"
            ref={yesRef}
            onClick={() => {
              allowAgain(item);
              setAsking(false);
            }}
          >
            {text.allowYes}
          </Btn>
          <Btn
            size="sm"
            kind="ghost"
            onClick={() => {
              backed.current = true;
              setAsking(false);
            }}
          >
            {text.allowKeep}
          </Btn>
        </span>
      ) : (
        <Btn
          size="sm"
          icon="undo"
          ref={allowRef}
          label={text.allowLabel(item.name)}
          onClick={() => {
            setAsking(true);
          }}
        >
          {text.allow}
        </Btn>
      )}
    </div>
  );
}

/**
 * Toolbox › Never contact (D39): add a channel from the catalog with an optional reason, and the
 * list of everyone blocked, newest first, each with "Allow again".
 */
export function NeverTool() {
  const list = useToolboxList("never");
  const [now] = useState(() => Date.now());
  const ids = useMemo(() => list.items.map((i) => i.id), [list.items]);
  // When a row leaves (allowed again), focus moves to its neighbour so the keyboard keeps its place.
  const box = useRef<HTMLDivElement>(null);
  const before = useRef<readonly string[]>([]);
  useEffect(() => {
    const was = before.current;
    before.current = ids;
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (!lost || was.length <= ids.length) {
      return;
    }
    const gone = was.findIndex((id) => !ids.includes(id));
    const next = ids[Math.min(gone, ids.length - 1)];
    const target =
      next === undefined
        ? box.current?.parentElement?.querySelector<HTMLElement>("input")
        : box.current?.querySelector<HTMLElement>(`[data-row="${next}"] .li`);
    target?.focus();
  }, [ids]);
  return (
    <div className="col" data-ui="toolbox.never">
      <AddChannel />
      <div className="col tight" ref={box}>
        {list.status === "failed" ? (
          <Empty icon="alert" title={shared.loadFailed} />
        ) : list.status === "loading" ? null : list.items.length === 0 ? (
          <Empty icon="ban" title={text.emptyTitle}>
            {text.emptyHint}
          </Empty>
        ) : (
          list.items.map((item) => <NeverRow key={item.id} item={item} ids={ids} now={now} />)
        )}
        {list.hasMore ? (
          <div>
            <Btn size="sm" onClick={list.loadMore}>
              {list.moreFailed ? shared.moreFailed : shared.showMore}
            </Btn>
          </div>
        ) : null}
      </div>
    </div>
  );
}
