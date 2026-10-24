import type { ConnectionsStatus, GeminiStatus } from "@gratovo/ipc";
import { Btn } from "@gratovo/ui";
import { useState } from "react";

import { toast } from "../../lib/toast";
import { strings } from "../../strings";
import { Row } from "../row";
import { Line, Problem, StateTag } from "./parts";
import { applyConnections, ask, failToast } from "./use-connections";

const text = strings.settings.connections;
const words = text.gemini;
const rows = strings.settings.rows;

const stateTone = {
  stopped: undefined,
  starting: "info",
  listening: "good",
  failed: "crit",
} as const;
const addonTone = { connected: "good", disconnected: "warn", missing: "crit" } as const;

/** The Gemini bridge: its state, the browser add-on, what went wrong, and the three buttons. */
export function GeminiRow({ status }: { readonly status: ConnectionsStatus }) {
  const [busy, setBusy] = useState(false);
  const gemini = status.gemini;
  const addonWords =
    gemini.addon.state === "connected"
      ? words.addon.connected(gemini.addon.version)
      : words.addon[gemini.addon.state];
  const run = (
    channel: "gemini:start" | "gemini:stop" | "gemini:open-window",
    done: { readonly msg: string; readonly sub: string },
  ): void => {
    setBusy(true);
    const asked =
      channel === "gemini:open-window" ? ask(channel, { browser: null }) : ask(channel, {});
    void asked.then((next: GeminiStatus | null) => {
      setBusy(false);
      if (next === null) {
        failToast(words.failed, words.failedSub);
        return;
      }
      applyConnections({ ...status, gemini: next });
      if (next.problem !== null && channel !== "gemini:stop") {
        failToast(words.failed, words.problems[next.problem]);
        return;
      }
      toast({ msg: done.msg, sub: done.sub, icon: "check", tone: "good" });
    });
  };
  const up = gemini.state === "listening" || gemini.state === "starting";
  return (
    <Row
      id="connGemini"
      label={rows.connGemini.label}
      scope="team"
      desc={rows.connGemini.desc}
      ui="settings.connections.gemini"
    >
      <Line>
        <StateTag
          tone={stateTone[gemini.state]}
          icon={gemini.state === "listening" ? "check" : undefined}
        >
          {words.states[gemini.state]}
        </StateTag>
        <StateTag tone={addonTone[gemini.addon.state]}>{addonWords}</StateTag>
        <span className="small ink2">
          {gemini.browser === null ? words.noBrowser : words.browser(gemini.browser)}
        </span>
      </Line>
      {gemini.problem === null ? null : <Problem>{words.problems[gemini.problem]}</Problem>}
      <div className="row wrap">
        <Btn
          kind="pri"
          size="sm"
          icon="play"
          disabled={busy || up}
          onClick={() => {
            run("gemini:start", { msg: words.started, sub: words.startedSub });
          }}
        >
          {words.start}
        </Btn>
        <Btn
          size="sm"
          icon="pause"
          disabled={busy || gemini.state === "stopped"}
          onClick={() => {
            run("gemini:stop", { msg: words.stopped, sub: words.stoppedSub });
          }}
        >
          {words.stop}
        </Btn>
        <Btn
          size="sm"
          icon="external"
          disabled={busy}
          onClick={() => {
            run("gemini:open-window", { msg: words.opened, sub: words.openedSub });
          }}
        >
          {words.openWindow}
        </Btn>
      </div>
      <span className="hint">{words.hint}</span>
    </Row>
  );
}
