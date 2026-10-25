import type { ThreadMessage } from "@gratovo/core/data";
import { Btn, Kbd } from "@gratovo/ui";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { clock, shortDate } from "../lib/format";
import { pasteReply } from "../lib/reach-actions";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { Reading } from "./reading";

const text = strings.reach.emails;
const pasteText = text.paste;
/** How many of the newest messages show before "Show N earlier". */
const shownAtFirst = 3;

/** Paste a reply by hand: a ghost button that opens a box (prototype W.Thread). */
function PasteReply({
  creatorId,
  theirName,
  onAdded,
}: {
  readonly creatorId: string;
  readonly theirName: string;
  readonly onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // Opening the box puts the cursor in it.
  useEffect(() => {
    if (open) {
      box.current?.focus();
    }
  }, [open]);
  const add = (): void => {
    if (busy || value.trim() === "") {
      return;
    }
    setBusy(true);
    void pasteReply(creatorId, value).then((added) => {
      setBusy(false);
      if (added) {
        setValue("");
        setOpen(false);
        onAdded();
      }
    });
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      add();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };
  if (!open) {
    return (
      <div className="row">
        <Btn
          size="sm"
          kind="ghost"
          icon="paste"
          onClick={() => {
            setOpen(true);
          }}
        >
          {pasteText.open}
        </Btn>
      </div>
    );
  }
  return (
    <div className="col tight" data-ui="record.emails.paste">
      <textarea
        className="ta"
        rows={4}
        ref={box}
        placeholder={pasteText.placeholder(theirName)}
        aria-label={pasteText.label}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onKeyDown={onKey}
      />
      <div className="row wrap">
        <Btn size="sm" kind="pri" icon="paste" disabled={busy || value.trim() === ""} onClick={add}>
          {pasteText.add} <Kbd>Ctrl Enter</Kbd>
        </Btn>
        <Btn
          size="sm"
          kind="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          {pasteText.cancel} <Kbd>Esc</Kbd>
        </Btn>
        <span className="hint">{pasteText.hint}</span>
      </div>
    </div>
  );
}

/**
 * One creator's emails as bubbles, newest at the bottom: theirs on the left, ours on the right.
 * The oldest are folded behind "Show N earlier".
 */
export function Thread({
  messages,
  theirName,
  creatorId,
  onPasted,
}: {
  readonly messages: readonly ThreadMessage[];
  /** Who the messages in are from. */
  readonly theirName: string;
  /** With `creatorId`, the thread shows Gemini's reading of their last reply. */
  readonly creatorId?: string;
  /** Given, the thread offers "Paste a reply by hand" once it holds an email out. */
  readonly onPasted?: () => void;
}) {
  const [all, setAll] = useState(false);
  const team = useApp((s) => s.data.team);
  const shown = all ? messages : messages.slice(-shownAtFirst);
  const hidden = messages.length - shown.length;
  const lastIn = messages.findLast((m) => m.direction === "in");
  const who = (m: ThreadMessage): string => {
    if (m.direction === "in") {
      return m.peerName ?? theirName;
    }
    const by = m.by === null ? undefined : team.find((member) => member.id === m.by);
    return by === undefined || by.name === "" ? text.you : by.name;
  };
  return (
    <div className="col" style={{ gap: "10px" }} data-ui="record.emails.thread">
      {hidden > 0 ? (
        <Btn
          size="sm"
          kind="ghost"
          onClick={() => {
            setAll(true);
          }}
        >
          {text.earlier(hidden)}
        </Btn>
      ) : null}
      {messages.length === 0 ? <p className="hint">{text.none}</p> : null}
      <div className="thread">
        {shown.map((m) => (
          <div key={m.id} className={`msg ${m.direction}`}>
            <div className="mh">
              <span>{who(m)}</span>
              <span>
                {shortDate(m.at)} {clock(m.at)}
              </span>
              {m.source === "pasted" ? <span>· {text.pasted}</span> : null}
            </div>
            {m.body}
          </div>
        ))}
      </div>
      {lastIn !== undefined && creatorId !== undefined ? (
        <Reading creatorId={creatorId} message={lastIn} />
      ) : null}
      {onPasted !== undefined &&
      creatorId !== undefined &&
      messages.some((m) => m.direction === "out") ? (
        <PasteReply creatorId={creatorId} theirName={theirName} onAdded={onPasted} />
      ) : null}
    </div>
  );
}
