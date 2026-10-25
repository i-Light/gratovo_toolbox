import type { ThreadMessage } from "@gratovo/core/data";
import { replyItems } from "@gratovo/core/reach";
import type { ReplyItem, ReplyState } from "@gratovo/core/reach";
import { avatarColor, Avatar, Btn, cx, Empty, Icon, Tag } from "@gratovo/ui";
import { useEffect, useMemo, useState } from "react";

import { peek, openRecord } from "../lib/actions";
import { ago } from "../lib/format";
import { useKeys } from "../lib/keys";
import { checkReplies, loadThread } from "../lib/reach-actions";
import { appStore, go, useApp } from "../lib/store";
import { useNow } from "../lib/use-now";
import { DraftCard } from "../record/draft-card";
import { Thread } from "../record/thread";
import { strings } from "../strings";
import { replyTone, shortReading } from "./reach-view";

const text = strings.reach.replies;
const stageNames = strings.record.stages;

const toneOf = (tone: ReturnType<typeof replyTone>): { tone?: NonNullable<typeof tone> } =>
  tone === undefined ? {} : { tone };

/** The words and look of the row's last line. */
const stateClass: Record<ReplyState, string | undefined> = {
  draft: "go",
  writing: "go",
  answered: undefined,
  your_move: undefined,
  bounced: undefined,
};

function ReplyRow({
  item,
  selected,
  now,
  onPick,
}: {
  readonly item: ReplyItem;
  readonly selected: boolean;
  readonly now: number;
  readonly onPick: () => void;
}) {
  const { creator, thread } = item;
  const reading = thread.lastIn?.reading ?? null;
  const bounced = item.state === "bounced";
  const tag =
    reading === null
      ? bounced
        ? text.state.bounced
        : text.noReading
      : shortReading(reading.label);
  return (
    <button
      type="button"
      className="li"
      role="option"
      aria-selected={selected}
      data-ui="reach.reply"
      onClick={onPick}
    >
      <Avatar name={creator.name} color={avatarColor(creator.handle)} size="s" decorative />
      <span className="lt">
        <span className="row" style={{ gap: "6px" }}>
          <b>{creator.name}</b>
          <Tag {...toneOf(replyTone(reading?.replyType ?? null, bounced))}>{tag}</Tag>
        </span>
        <small>{thread.lastIn?.preview ?? ""}</small>
      </span>
      <span className="rt">
        <span className="due">{ago(item.at, now)}</span>
        <small className={stateClass[item.state]}>{text.state[item.state]}</small>
      </span>
    </button>
  );
}

type Loaded =
  | { readonly id: string; readonly messages: readonly ThreadMessage[] }
  | { readonly id: string; readonly messages: null };

/** One reply opened: the conversation with Gemini's reading, then the answer. */
function ReplyDetail({ item, ids }: { readonly item: ReplyItem; readonly ids: readonly string[] }) {
  const { creator, thread, draft } = item;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  // The summary changes with each new message, so it is the cue to read the thread again.
  const cue = `${String(thread.count)}:${String(thread.lastOutAt ?? 0)}:${thread.lastIn?.id ?? ""}`;
  useEffect(() => {
    let stopped = false;
    void loadThread(creator.id).then((messages) => {
      if (!stopped) {
        setLoaded({ id: creator.id, messages });
      }
    });
    return () => {
      stopped = true;
    };
  }, [creator.id, cue, tick]);
  const mine = loaded?.id === creator.id ? loaded : null;
  const open = (): void => {
    peek({ kind: "creator", id: creator.id }, ids, { tab: "emails" });
  };
  return (
    <>
      <div className="rp-head">
        <Avatar name={creator.name} color={avatarColor(creator.handle)} size="l" decorative />
        <div className="grow">
          <h2>{creator.name}</h2>
          <span className="small ink2 row wrap" style={{ gap: "8px" }}>
            <span>{creator.handle}</span>
            <Tag>{stageNames[creator.stage]}</Tag>
          </span>
        </div>
        <Btn size="sm" kind="ghost" icon="eye" tip={text.openRecordTip} kbd="O" onClick={open}>
          {text.openRecord}
        </Btn>
      </div>
      <div className="card" data-ui="reach.reply.thread">
        <div className="card-h">
          <h3>{text.conversation}</h3>
          <span className="small muted">{text.emails(thread.count)}</span>
        </div>
        {mine === null ? (
          <p className="hint" role="status">
            {strings.creatorRecord.loading}
          </p>
        ) : mine.messages === null ? (
          <div className="col tight">
            <p className="hint">{text.loadFailed}</p>
            <div className="row">
              <Btn
                size="sm"
                onClick={() => {
                  setTick((n) => n + 1);
                }}
              >
                {text.retry}
              </Btn>
            </div>
          </div>
        ) : (
          <Thread
            messages={mine.messages}
            theirName={creator.contactName ?? creator.name}
            creatorId={creator.id}
          />
        )}
      </div>
      {draft !== null ? (
        <DraftCard key={draft.id} draftId={draft.id} />
      ) : item.state === "bounced" ? (
        <div className="callout crit" role="status">
          <Icon name="alert" />
          <span>
            <b>{text.bouncedTitle}</b> {text.bouncedText}
          </span>
        </div>
      ) : item.state === "answered" ? (
        <div className="callout" role="status">
          <Icon name="clock" />
          <span>
            <b>{text.answeredTitle}</b> {text.answeredText}
          </span>
        </div>
      ) : (
        <div className="callout warn" role="status">
          <Icon name="reply" />
          <span>
            <b>{text.yourMoveTitle}</b> {text.yourMoveText}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Reach › Replies (D23; prototype reach.js Inbox): a list of everyone who wrote back, newest first,
 * and the one picked opens beside it with the conversation, Gemini's reading and the answer.
 */
export function Replies() {
  const creators = useApp((s) => s.data.creators);
  const threads = useApp((s) => s.data.reach.threads);
  const drafts = useApp((s) => s.data.reach.drafts);
  const now = useNow();
  const [picked, setPicked] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const items = useMemo(() => replyItems(creators, threads, drafts), [creators, threads, drafts]);
  const cur = items.find((i) => i.creator.id === picked) ?? items[0] ?? null;
  const ids = items.map((i) => i.creator.id);
  const move = (by: 1 | -1): boolean => {
    if (items.length === 0 || appStore().getState().ui.peek !== null) {
      return false;
    }
    const here = cur === null ? 0 : items.indexOf(cur);
    const next = items[Math.min(items.length - 1, Math.max(0, here + by))];
    if (next !== undefined) {
      setPicked(next.creator.id);
    }
    return true;
  };
  useKeys({
    j: () => move(1),
    k: () => move(-1),
    arrowdown: () => move(1),
    arrowup: () => move(-1),
    o: () => {
      if (cur === null || appStore().getState().ui.peek !== null) {
        return false;
      }
      openRecord({ kind: "creator", id: cur.creator.id });
      return true;
    },
  });
  const check = (): void => {
    if (checking) {
      return;
    }
    setChecking(true);
    void checkReplies().then(() => {
      setChecking(false);
    });
  };
  const checkButton = (
    <Btn size="sm" icon="refresh" disabled={checking} onClick={check}>
      {checking ? text.checking : text.checkNow}
    </Btn>
  );
  if (items.length === 0) {
    return (
      <div className="col" data-ui="reach.replies">
        <div className="row">
          <span className="sp"></span>
          {checkButton}
        </div>
        <div className="card">
          <Empty
            icon="inbox"
            title={text.emptyTitle}
            action={
              <Btn
                size="sm"
                onClick={() => {
                  go("reach", "board");
                }}
              >
                {text.emptyAction}
              </Btn>
            }
          >
            {text.emptyHint}
          </Empty>
        </div>
      </div>
    );
  }
  return (
    <div className="col" data-ui="reach.replies">
      <div className="row">
        <span className="sp"></span>
        {checkButton}
      </div>
      <div className="rp-split">
        <div className={cx("card", "queue")} role="listbox" aria-label={text.list}>
          {items.map((item) => (
            <ReplyRow
              key={item.creator.id}
              item={item}
              selected={item === cur}
              now={now}
              onPick={() => {
                setPicked(item.creator.id);
              }}
            />
          ))}
        </div>
        <div className="rp-work">
          {cur === null ? null : <ReplyDetail key={cur.creator.id} item={cur} ids={ids} />}
        </div>
      </div>
    </div>
  );
}
