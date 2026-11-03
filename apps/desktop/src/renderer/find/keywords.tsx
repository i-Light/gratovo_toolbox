import { failureLimit, type FindState, type QueueRow } from "@gratovo/ipc";
import { Btn, Icon, cx } from "@gratovo/ui";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { addMax, keywordMax, parseKeywords } from "../lib/find";
import { strings } from "../strings";
import { KeywordGen } from "./keyword-gen";
import { KeywordIdeas, useIdeas } from "./keyword-ideas";

const text = strings.findSearch.keywords;

interface RowProps {
  readonly item: QueueRow;
  /** The entry the search runs next. */
  readonly next: boolean;
  readonly canStartHere: boolean;
  readonly canRemove: boolean;
  readonly canRetry: boolean;
  readonly onRetry: (index: number, keyword: string) => void;
  readonly onStartHere: (index: number, keyword: string) => void;
  readonly onRemove: (index: number, keyword: string) => void;
}

function Status({ item, next }: Pick<RowProps, "item" | "next">) {
  if (item.state === "done") {
    return (
      <span className="yield" data-tip={text.yieldTip(item.found, item.kept)}>
        {text.found(item.found, item.kept)}
        <i>
          <b style={{ width: `${String(item.found > 0 ? (100 * item.kept) / item.found : 0)}%` }} />
        </i>
      </span>
    );
  }
  if (item.state === "running") {
    return (
      <span className="yield">
        <Icon name="refresh" className="spin" size={13} />
        {text.searching}
      </span>
    );
  }
  if (item.state === "failed") {
    return (
      <span className="yield kw-failed" data-tip={text.failedTip(failureLimit)}>
        {text.failed}
      </span>
    );
  }
  return next ? (
    <span className="yield kw-next">{text.next}</span>
  ) : (
    <span className="yield">{text.queued}</span>
  );
}

const Row = memo(function Row({
  item,
  next,
  canStartHere,
  canRemove,
  canRetry,
  onRetry,
  onStartHere,
  onRemove,
}: RowProps) {
  const { index } = item;
  const madeBy = text.madeBy(item.tool, item.angle);
  return (
    <li className={cx("kw", item.state)} data-ui="find.search.keyword">
      <span className="n">{index + 1}</span>
      <span className="q" title={item.keyword}>
        <span className="ell">
          {item.state === "done" ? (
            <Icon name="check" size={13} className="kw-check" title={text.done} />
          ) : null}
          {item.keyword}
        </span>
        {madeBy === "" ? null : <span className="kw-meta ell">{madeBy}</span>}
      </span>
      <span className="acts">
        {item.rank === null ? null : (
          <span
            className="kw-rank"
            data-tip={item.rank === "up" ? text.rankUpTip : text.rankBackTip}
          >
            {item.rank === "up" ? text.rankUp : text.rankBack}
          </span>
        )}
        <Status item={item} next={next} />
        {canRetry ? (
          <Btn
            kind="ghost"
            size="sm"
            icon="refresh"
            label={text.retryLabel(item.keyword)}
            onClick={() => {
              onRetry(index, item.keyword);
            }}
          >
            {text.retry}
          </Btn>
        ) : null}
        {canStartHere ? (
          <Btn
            kind="ghost"
            size="sm"
            label={text.startHereLabel(item.keyword)}
            onClick={() => {
              onStartHere(index, item.keyword);
            }}
          >
            {text.startHere}
          </Btn>
        ) : null}
        {canRemove ? (
          <Btn
            kind="ghost"
            size="sm"
            icon="x"
            label={text.removeLabel(item.keyword)}
            tip={text.remove}
            onClick={() => {
              onRemove(index, item.keyword);
            }}
          />
        ) : null}
      </span>
    </li>
  );
});

const pageSize = 100;
type Filter = "all" | "todo" | "done" | "failed";
const filters: readonly Filter[] = ["all", "todo", "done", "failed"];
type EditChannel = "find:start-at" | "find:remove" | "find:retry";

interface ListProps {
  readonly queue: FindState["queue"];
  readonly at: number;
  readonly active: boolean;
  /** Resolves true when main found the page stale (another keyword at that place). */
  readonly onEdit: (channel: EditChannel, index: number, keyword: string) => Promise<boolean>;
}

/**
 * The keyword list: one page of 100 at a time, with a filter and a pager. It asks main for its
 * page and asks again when the queue's version moves (plan S6, K2).
 */
export function KeywordList({ queue, at, active, onEdit }: ListProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ readonly total: number; readonly rows: readonly QueueRow[] }>({
    total: 0,
    rows: [],
  });
  const [failed, setFailed] = useState(false);
  // Bumped when an edit came back stale: the page asks for its rows again.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    window.gratovo
      .invoke("find:keywords", { offset, limit: pageSize, filter })
      .then((result) => {
        if (!current) {
          return;
        }
        if (!result.ok) {
          setFailed(true);
          return;
        }
        setFailed(false);
        const { total, rows } = result.value;
        if (rows.length === 0 && total > 0 && offset >= total) {
          // The list shrank under this page: go to the last page.
          setOffset(Math.floor((total - 1) / pageSize) * pageSize);
          return;
        }
        setPage({ total, rows });
      })
      .catch(() => {
        if (current) {
          setFailed(true);
        }
      });
    return () => {
      current = false;
    };
  }, [offset, filter, queue.version, reload]);

  const edit = useCallback(
    (channel: EditChannel, index: number, keyword: string): void => {
      void onEdit(channel, index, keyword).then((stale) => {
        if (stale) {
          setReload((n) => n + 1);
        }
      });
    },
    [onEdit],
  );
  const retry = useCallback(
    (index: number, keyword: string) => {
      edit("find:retry", index, keyword);
    },
    [edit],
  );
  const startHere = useCallback(
    (index: number, keyword: string) => {
      edit("find:start-at", index, keyword);
    },
    [edit],
  );
  const remove = useCallback(
    (index: number, keyword: string) => {
      edit("find:remove", index, keyword);
    },
    [edit],
  );

  const { total, rows } = page;
  const goNext = (): void => {
    setFilter("all");
    setOffset(Math.floor(Math.min(at, Math.max(queue.total - 1, 0)) / pageSize) * pageSize);
  };

  if (queue.total === 0) {
    return <p className="hint">{text.empty}</p>;
  }
  return (
    <div className="col tight" data-ui="find.search.keyword-list">
      <div className="row wrap kw-bar">
        <div className="seg" role="group" aria-label={text.filterLabel}>
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => {
                setFilter(f);
                setOffset(0);
              }}
            >
              {text.filters[f]}
            </button>
          ))}
        </div>
        {queue.queued + queue.running > 0 && at < queue.total ? (
          <Btn size="sm" kind="ghost" onClick={goNext}>
            {text.goNext}
          </Btn>
        ) : null}
        <span className="kw-pager row" role="group" aria-label={text.pagerLabel}>
          <span className="muted num" aria-live="polite">
            {total === 0 ? "" : text.pageRange(offset + 1, offset + rows.length, total)}
          </span>
          <Btn
            size="sm"
            kind="ghost"
            icon="chevL"
            label={text.prevPage}
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - pageSize));
            }}
          />
          <Btn
            size="sm"
            kind="ghost"
            icon="chevR"
            label={text.nextPage}
            disabled={offset + pageSize >= total}
            onClick={() => {
              setOffset(offset + pageSize);
            }}
          />
        </span>
      </div>
      {failed ? (
        <p className="hint kw-bad" role="status">
          {text.loadFailed}
        </p>
      ) : null}
      {rows.length === 0 && !failed ? (
        <p className="hint">{text.noneInFilter}</p>
      ) : (
        <ul className="kw-list" data-ui="find.search.queue" aria-label={text.listLabel}>
          {rows.map((item) => (
            <Row
              key={`${String(item.index)}:${item.keyword}`}
              item={item}
              next={item.index === at && item.state !== "done"}
              canStartHere={item.state === "queued" && item.index !== at && !active}
              canRemove={item.state !== "running" && !active}
              canRetry={(item.state === "failed" || item.state === "done") && !active}
              onRetry={retry}
              onStartHere={startHere}
              onRemove={remove}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The keyword queue: the list, and the box to paste more into. */
export function Keywords({ state }: { readonly state: FindState }) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<{ readonly text: string; readonly bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const ideas = useIdeas();
  const suggest = useRef<HTMLButtonElement>(null);
  const { queue, at } = state;
  const active =
    state.run.state === "running" ||
    state.run.state === "waiting" ||
    state.run.state === "stopping";
  const ready = parseKeywords(draft);

  const edit = useCallback(
    async (channel: EditChannel, index: number, keyword: string): Promise<boolean> => {
      setNote(null);
      try {
        const result = await window.gratovo.invoke(channel, { index, keyword });
        if (!result.ok) {
          setNote({ text: text.editFailed, bad: true });
        } else if (!result.value.ok) {
          // A stale page needs no word: the list reads its rows again and shows the queue as it is.
          if (result.value.problem === "stale") {
            return true;
          }
          setNote({ text: text.editRunning, bad: true });
        }
      } catch {
        setNote({ text: text.editFailed, bad: true });
      }
      return false;
    },
    [],
  );

  // How many finished keywords found too little; asked again when a run ends or the list changes.
  const [weak, setWeak] = useState(0);
  const [asking, setAsking] = useState(false);
  // One flag, so running to waiting and back does not read the database again.
  const runActive =
    state.run.state === "running" ||
    state.run.state === "stopping" ||
    state.run.state === "waiting";
  // Each ask reads pipeline.db, so not on every keyword of a run: once as it starts, once as it
  // ends (the button is off while it runs anyway), and on each change of the queue between runs.
  const weakKey = runActive ? -1 : queue.version;
  useEffect(() => {
    let current = true;
    window.gratovo
      .invoke("find:count-weak", {})
      .then((result) => {
        if (current && result.ok) {
          setWeak(result.value.count);
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [weakKey]);
  const requeue = async (): Promise<void> => {
    setAsking(false);
    setNote(null);
    try {
      const result = await window.gratovo.invoke("find:requeue-weak", {});
      if (!result.ok) {
        setNote({ text: text.weak.failed, bad: true });
      } else if (!result.value.ok) {
        setNote({ text: text.weak.running, bad: true });
      } else {
        const { requeued, added, skipped } = result.value;
        setNote({ text: text.weak.done(requeued, added, skipped), bad: false });
      }
    } catch {
      setNote({ text: text.weak.failed, bad: true });
    }
  };

  const add = async (): Promise<void> => {
    if (ready.length === 0 || busy) {
      return;
    }
    if (ready.some((k) => k.length > keywordMax)) {
      setNote({ text: text.tooLong, bad: true });
      return;
    }
    if (ready.length > addMax) {
      setNote({ text: text.tooMany, bad: true });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const result = await window.gratovo.invoke("find:add", { keywords: ready });
      if (result.ok) {
        setDraft("");
        setNote({ text: text.added(result.value.added, result.value.skipped), bad: false });
      } else {
        setNote({ text: text.addFailed, bad: true });
      }
    } catch {
      setNote({ text: text.addFailed, bad: true });
    } finally {
      setBusy(false);
    }
  };

  // Closing the picker (Esc or Close) sends focus back to the button that opened it.
  const closeIdeas = (): void => {
    setIdeasOpen(false);
    suggest.current?.focus();
  };
  const toggleIdeas = (): void => {
    if (ideasOpen) {
      setIdeasOpen(false);
      return;
    }
    setIdeasOpen(true);
    // Every opening asks afresh (the queue changed, or the bridge was started); one at a time.
    ideas.ask();
  };
  const addIdeas = async (keywords: readonly string[]): Promise<boolean> => {
    try {
      const result = await window.gratovo.invoke("find:add", { keywords: [...keywords] });
      if (!result.ok) {
        return false;
      }
      setNote({ text: text.added(result.value.added, result.value.skipped), bad: false });
      setIdeasOpen(false);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <section className="card" data-ui="find.search.keywords" aria-labelledby="find-kw-h">
      <div className="card-h">
        <h3 id="find-kw-h">
          {text.title}{" "}
          <span className="muted num" style={{ fontWeight: 400 }}>
            {text.count(queue.total, queue.done)}
          </span>
        </h3>
        <Btn
          ref={suggest}
          size="sm"
          icon="sparkle"
          {...(ideasOpen ? { kind: "pri" } : {})}
          expanded={ideasOpen}
          onClick={toggleIdeas}
        >
          {strings.findSearch.ideas.suggest}
        </Btn>
      </div>
      {ideasOpen ? (
        <KeywordIdeas state={ideas.state} onAsk={ideas.ask} onClose={closeIdeas} onAdd={addIdeas} />
      ) : null}
      {weak > 0 ? (
        <div className="col tight" data-ui="find.search.weak">
          <div className="row wrap">
            <Btn
              size="sm"
              icon="refresh"
              disabled={active}
              expanded={asking}
              onClick={() => {
                setAsking(!asking);
              }}
            >
              {text.weak.action(weak)}
            </Btn>
          </div>
          {asking ? (
            <div className="col tight" role="group" aria-label={text.weak.action(weak)}>
              <p className="hint">{text.weak.ask(weak)}</p>
              <div className="row wrap">
                <Btn
                  size="sm"
                  kind="pri"
                  onClick={() => {
                    void requeue();
                  }}
                >
                  {text.weak.confirm}
                </Btn>
                <Btn
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    setAsking(false);
                  }}
                >
                  {text.weak.cancel}
                </Btn>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <KeywordGen />
      <KeywordList queue={queue} at={at} active={active} onEdit={edit} />
      <div className="col tight">
        <textarea
          className="ta"
          data-ui="find.search.input"
          rows={3}
          placeholder={text.placeholder}
          aria-label={text.inputLabel}
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
        />
        <div className="row wrap">
          <Btn
            size="sm"
            icon="plus"
            disabled={ready.length === 0 || busy}
            onClick={() => {
              void add();
            }}
          >
            {text.add}
          </Btn>
          <span className="hint">
            {ready.length > 0 ? text.hintReady(ready.length) : text.hintEmpty}
          </span>
        </div>
        <p className={cx("hint kw-note", note?.bad === true && "kw-bad")} role="status">
          {note?.text}
        </p>
      </div>
    </section>
  );
}
