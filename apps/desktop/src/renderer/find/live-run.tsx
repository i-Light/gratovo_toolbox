import type { FindState } from "@gratovo/ipc";
import { Btn, Icon, cx } from "@gratovo/ui";
import { useEffect, useRef, useState } from "react";

import { clock } from "../lib/format";
import { strings } from "../strings";
import { reviewResults } from "./triage";

const text = strings.findSearch.live;

type RunState = FindState["run"]["state"];

/**
 * The run's state as the page shows it, read through the queue when no run is going: after a
 * restart main reports "ready" again, and after a finished run keywords may have been added since.
 * All done reads as finished; keywords added after a finished run wait to be started; a run a
 * restart interrupted partway reads as paused there.
 */
function shownState({ run, queue, at }: FindState): RunState {
  if ((run.state !== "ready" && run.state !== "done") || queue.length === 0) {
    return run.state;
  }
  if (queue.every((k) => k.state === "done")) {
    return "done";
  }
  return run.state === "done" || at === 0 ? "ready" : "paused";
}

function headline(state: FindState): string {
  const { queue, at } = state;
  const n = Math.min(at, Math.max(queue.length - 1, 0)) + 1;
  switch (shownState(state)) {
    case "running": {
      const current = queue.find((k) => k.state === "running") ?? queue[at];
      return text.searching(current?.keyword ?? "");
    }
    case "done":
      return text.done;
    case "ready":
      return text.ready(queue.filter((k) => k.state !== "done").length);
    case "paused":
      return text.paused(n);
    case "failed":
      return text.failed(n);
    case "stopping":
      return text.stopping;
  }
}

/** Where the search stands: its headline, the tallies, the log and the Start / Pause button. */
export function LiveRun({ state }: { readonly state: FindState }) {
  const { run, queue, at, log } = state;
  const running = run.state === "running";
  const stopping = run.state === "stopping";
  const done = queue.filter((k) => k.state === "done").length;
  const total = queue.length;
  const finished = shownState(state) === "done";
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [log.length]);

  const press = async (): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      if (running) {
        const result = await window.gratovo.invoke("find:stop", {});
        if (!result.ok) {
          setProblem(text.stopFailed);
        }
      } else {
        const result = await window.gratovo.invoke("find:start", {});
        if (!result.ok) {
          setProblem(text.startFailed);
        } else if (!result.value.ok) {
          setProblem(strings.findSearch.startProblems[result.value.problem]);
        }
      }
    } catch {
      setProblem(running ? text.stopFailed : text.startFailed);
    } finally {
      setBusy(false);
    }
  };

  const shown = shownState(state);
  const startLabel =
    shown === "failed" ? text.retry(at + 1) : shown === "paused" ? text.resume(at + 1) : text.start;
  const pct = total === 0 ? 0 : Math.min(100, (100 * (done + (running ? 0.5 : 0))) / total);
  const working = running || stopping;

  return (
    <section className="card" aria-labelledby="find-live-h">
      <div className="card-h">
        <h3 id="find-live-h" className="row live-h">
          {working ? (
            <Icon name="refresh" className="spin live-ic" />
          ) : (
            <Icon
              name={finished ? "checkc" : run.state === "failed" ? "alert" : "pause"}
              className={run.state === "failed" ? "live-bad" : "muted"}
            />
          )}
          <span className="live-t">{headline(state)}</span>
        </h3>
        <span className="num small muted">{text.progress(done, total)}</span>
      </div>
      <span
        className="meter"
        style={{ width: "100%" }}
        role="meter"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={text.meterLabel}
      >
        <i style={{ width: `${String(pct)}%` }}></i>
      </span>
      <div className="minis">
        <div className="mini-stat">
          <b>{run.found.toLocaleString("en-US")}</b>
          <small>{text.found}</small>
        </div>
        <div className="mini-stat">
          <b>{run.kept.toLocaleString("en-US")}</b>
          <small>{text.kept}</small>
        </div>
        <div className="mini-stat">
          <b>{run.swept.toLocaleString("en-US")}</b>
          <small>{text.swept}</small>
        </div>
      </div>
      {run.state === "failed" && run.error !== null ? (
        <div className="callout crit" role="alert">
          <Icon name="alert" />
          <span>{strings.findSearch.errors[run.error]}</span>
        </div>
      ) : null}
      <div className="log" ref={logRef} role="log" aria-live="polite" aria-label={text.logLabel}>
        {log.length === 0 ? (
          <div className="faint">{text.logEmpty}</div>
        ) : (
          log.map((line, i) => (
            <div key={i} className={cx(line.level !== "info" && `log-${line.level}`)}>
              <span className="t">{clock(line.at)}</span> {line.text}
            </div>
          ))
        )}
      </div>
      <div className="row wrap">
        {finished ? null : (
          <>
            {working ? (
              <Btn
                icon="pause"
                disabled={stopping || busy}
                onClick={() => {
                  void press();
                }}
              >
                {text.pause}
              </Btn>
            ) : (
              <Btn
                kind="pri"
                icon={run.state === "failed" ? "refresh" : "play"}
                disabled={busy}
                onClick={() => {
                  void press();
                }}
              >
                {startLabel}
              </Btn>
            )}
            <span className="hint">{working ? text.pauseHint : text.startHint}</span>
          </>
        )}
        <span className="sp"></span>
        <Btn
          size="sm"
          kind="ghost"
          icon="scan"
          onClick={() => {
            reviewResults(null);
          }}
        >
          {text.review}
        </Btn>
      </div>
      <p className="hint kw-note kw-bad" role="status">
        {problem}
      </p>
    </section>
  );
}
