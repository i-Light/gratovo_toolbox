import type { ThreadMessage } from "@gratovo/core/data";
import { useEffect, useState } from "react";

import { loadThread } from "../lib/reach-actions";
import { Thread } from "../record/thread";
import { strings } from "../strings";

const text = strings.today.pane;

/** The creator's last two emails, with a quiet line while they load. */
export function LastMessages({
  creatorId,
  name,
}: {
  readonly creatorId: string;
  readonly name: string;
}) {
  const [answer, setAnswer] = useState<{
    readonly id: string;
    readonly messages: readonly ThreadMessage[] | null;
  } | null>(null);
  const messages = answer?.id === creatorId ? answer.messages : undefined;
  useEffect(() => {
    let live = true;
    void loadThread(creatorId).then((m) => {
      if (live) {
        setAnswer({ id: creatorId, messages: m });
      }
    });
    return () => {
      live = false;
    };
  }, [creatorId]);
  if (messages === undefined) {
    return <p className="muted small">{text.threadLoading}</p>;
  }
  if (messages === null) {
    return <p className="muted small">{text.threadFailed}</p>;
  }
  return <Thread messages={messages.slice(-2)} theirName={name} creatorId={creatorId} />;
}
