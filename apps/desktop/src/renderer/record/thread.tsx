import type { ThreadMessage } from "@gratovo/core/data";
import { Btn } from "@gratovo/ui";
import { useState } from "react";

import { clock, shortDate } from "../lib/format";
import { useApp } from "../lib/store";
import { strings } from "../strings";

const text = strings.reach.emails;
/** How many of the newest messages show before "Show N earlier". */
const shownAtFirst = 3;

/**
 * One creator's emails as bubbles, newest at the bottom: theirs on the left, ours on the right.
 * The oldest are folded behind "Show N earlier".
 */
export function Thread({
  messages,
  theirName,
}: {
  readonly messages: readonly ThreadMessage[];
  /** Who the messages in are from. */
  readonly theirName: string;
}) {
  const [all, setAll] = useState(false);
  const team = useApp((s) => s.data.team);
  const shown = all ? messages : messages.slice(-shownAtFirst);
  const hidden = messages.length - shown.length;
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
    </div>
  );
}
