import { Btn, Icon } from "@gratovo/ui";
import { useState } from "react";

import { openSetting } from "../lib/actions";
import { clock } from "../lib/format";
import { toast } from "../lib/toast";
import { useApp } from "../lib/store";
import { strings } from "../strings";

const text = strings.reach.banner;

/** Starts the Gemini bridge (it sends no prompt); a failure says so in a toast. */
async function startGemini(): Promise<void> {
  try {
    const result = await window.gratovo.invoke("gemini:start", {});
    if (result.ok) {
      return;
    }
  } catch {
    // Falls through to the toast.
  }
  toast({ msg: text.startFailed, icon: "alert" });
}

/** The line above the board when drafts can't be written: Gemini off, paused, or no sender name. */
export function GeminiBanner() {
  const gemini = useApp((s) => s.data.reach.gemini);
  const pausedUntil = useApp((s) => s.data.reach.geminiPausedUntil);
  const [starting, setStarting] = useState(false);
  if (gemini === "ready") {
    return null;
  }
  let words: string;
  let action;
  if (gemini === "off") {
    words = text.off;
    action = (
      <Btn
        size="sm"
        disabled={starting}
        onClick={() => {
          setStarting(true);
          void startGemini().finally(() => {
            setStarting(false);
          });
        }}
      >
        {starting ? text.starting : text.start}
      </Btn>
    );
  } else if (gemini === "paused") {
    words = pausedUntil === null ? text.pausedNoTime : text.paused(clock(pausedUntil));
    action = null;
  } else {
    words = text.noSender;
    action = (
      <Btn
        size="sm"
        onClick={() => {
          openSetting("connections");
        }}
      >
        {text.openSettings}
      </Btn>
    );
  }
  return (
    <div className="callout warn" role="status" data-ui="reach.banner">
      <Icon name={gemini === "paused" ? "pause" : "alert"} />
      <span className="grow">{words}</span>
      {action}
    </div>
  );
}
