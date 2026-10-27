import type { FindState } from "@gratovo/ipc";
import { Btn, Icon, cx } from "@gratovo/ui";
import { memo, useCallback, useRef, useState } from "react";

import { addMax, keywordMax, parseKeywords } from "../lib/find";
import { strings } from "../strings";
import { KeywordIdeas, useIdeas } from "./keyword-ideas";

const text = strings.findSearch.keywords;

interface RowProps {
  readonly index: number;
  readonly item: FindState["queue"][number];
  /** The entry the search runs next. */
  readonly next: boolean;
  readonly canStartHere: boolean;
  readonly canRemove: boolean;
  readonly onStartHere: (index: number) => void;
  readonly onRemove: (index: number) => void;
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
    return <span className="yield kw-failed">{text.failed}</span>;
  }
  return next ? (
    <span className="yield kw-next">{text.next}</span>
  ) : (
    <span className="yield">{text.queued}</span>
  );
}

const Row = memo(function Row({
  index,
  item,
  next,
  canStartHere,
  canRemove,
  onStartHere,
  onRemove,
}: RowProps) {
  return (
    <li className={cx("kw", item.state)} data-ui="find.search.keyword">
      <span className="n">{index + 1}</span>
      <span className="q ell" title={item.keyword}>
        {item.state === "done" ? (
          <Icon name="check" size={13} className="kw-check" title={text.done} />
        ) : null}
        {item.keyword}
      </span>
      <span className="acts">
        <Status item={item} next={next} />
        {canStartHere ? (
          <Btn
            kind="ghost"
            size="sm"
            label={text.startHereLabel(item.keyword)}
            onClick={() => {
              onStartHere(index);
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
              onRemove(index);
            }}
          />
        ) : null}
      </span>
    </li>
  );
});

/** The keyword queue: the list, and the box to paste more into. */
export function Keywords({ state }: { readonly state: FindState }) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<{ readonly text: string; readonly bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const ideas = useIdeas();
  const suggest = useRef<HTMLButtonElement>(null);
  const { queue, at } = state;
  const active = state.run.state === "running" || state.run.state === "stopping";
  const done = queue.filter((k) => k.state === "done").length;
  const ready = parseKeywords(draft);

  const edit = useCallback(async (channel: "find:start-at" | "find:remove", index: number) => {
    setNote(null);
    try {
      const result = await window.gratovo.invoke(channel, { index });
      if (!result.ok) {
        setNote({ text: text.editFailed, bad: true });
      } else if (!result.value.ok) {
        setNote({ text: text.editRunning, bad: true });
      }
    } catch {
      setNote({ text: text.editFailed, bad: true });
    }
  }, []);
  const startHere = useCallback(
    (index: number) => {
      void edit("find:start-at", index);
    },
    [edit],
  );
  const remove = useCallback(
    (index: number) => {
      void edit("find:remove", index);
    },
    [edit],
  );

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
            {text.count(queue.length, done)}
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
        <KeywordIdeas
          state={ideas.state}
          have={queue.map((k) => k.keyword)}
          onAsk={ideas.ask}
          onClose={closeIdeas}
          onAdd={addIdeas}
        />
      ) : null}
      {queue.length === 0 ? (
        <p className="hint">{text.empty}</p>
      ) : (
        <ul className="kw-list" data-ui="find.search.queue" aria-label={text.listLabel}>
          {queue.map((item, i) => (
            <Row
              key={`${String(i)}:${item.keyword}`}
              index={i}
              item={item}
              next={i === at && item.state !== "done"}
              canStartHere={item.state === "queued" && i !== at && !active}
              canRemove={item.state !== "running" && !active}
              onStartHere={startHere}
              onRemove={remove}
            />
          ))}
        </ul>
      )}
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
