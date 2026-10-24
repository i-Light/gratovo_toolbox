import { Btn, Icon } from "@gratovo/ui";
import { useCallback, useRef, useState } from "react";

import { openSetting } from "../lib/actions";
import { isTyping, useKeys } from "../lib/keys";
import { strings } from "../strings";

const text = strings.findSearch.ideas;

/** How many ideas the card asks Gemini for. */
const askFor = 8;

export type IdeasState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly keywords: readonly string[]; readonly dropped: number }
  | { readonly phase: "problem"; readonly problem: "bridge_off" | "busy" | "failed" };

/** The state of the Gemini request. Only one runs at a time; closing the panel doesn't cancel it. */
export function useIdeas(): { readonly state: IdeasState; readonly ask: () => void } {
  const [state, setState] = useState<IdeasState>({ phase: "idle" });
  const inFlight = useRef(false);
  const ask = useCallback(() => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setState({ phase: "loading" });
    const done = (next: IdeasState): void => {
      inFlight.current = false;
      setState(next);
    };
    void (async () => {
      try {
        const result = await window.gratovo.invoke("find:ideas", { count: askFor });
        if (!result.ok) {
          done({ phase: "problem", problem: "failed" });
          return;
        }
        const answer = result.value;
        done(
          answer.ok
            ? { phase: "ready", keywords: answer.keywords, dropped: answer.dropped }
            : { phase: "problem", problem: answer.problem },
        );
      } catch {
        done({ phase: "problem", problem: "failed" });
      }
    })();
  }, []);
  return { state, ask };
}

interface PanelProps {
  readonly state: IdeasState;
  /** The queue's keywords, to tell which ideas are already in the list. */
  readonly have: readonly string[];
  readonly onAsk: () => void;
  readonly onClose: () => void;
  /** Called with the picked keywords; answers true when they were added. */
  readonly onAdd: (keywords: readonly string[]) => Promise<boolean>;
}

/** The inline picker under the Keywords header (prototype `ai-read`). */
export function KeywordIdeas({ state, have, onAsk, onClose, onAdd }: PanelProps) {
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Esc closes the panel, but never while typing in the paste box.
  useKeys({
    escape: (event) => {
      if (isTyping(event.target)) {
        return false;
      }
      onClose();
      return true;
    },
  });

  const owned = new Set(have.map((k) => k.toLowerCase()));
  const keywords = state.phase === "ready" ? state.keywords : [];
  const picked = keywords.filter((k) => !owned.has(k.toLowerCase()) && !off.has(k));

  const add = async (): Promise<void> => {
    if (picked.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setFailed(false);
    const ok = await onAdd(picked);
    setBusy(false);
    setFailed(!ok);
  };

  let body;
  if (state.phase === "loading" || state.phase === "idle") {
    body = (
      <div className="row">
        <Icon name="refresh" className="spin" size={13} />
        <span className="small">{text.busy}</span>
      </div>
    );
  } else if (state.phase === "problem") {
    body = (
      <div className="row wrap" role="status">
        <span className="small">
          {state.problem === "bridge_off"
            ? text.bridgeOff
            : state.problem === "busy"
              ? text.working
              : text.failed}
        </span>
        {state.problem === "bridge_off" ? (
          <Btn
            size="sm"
            onClick={() => {
              openSetting("connections");
            }}
          >
            {text.openConnections}
          </Btn>
        ) : state.problem === "failed" ? (
          <Btn size="sm" icon="refresh" onClick={onAsk}>
            {text.tryAgain}
          </Btn>
        ) : null}
      </div>
    );
  } else {
    body = (
      <>
        <div className="row">
          <Icon name="sparkle" />
          <b style={{ fontWeight: 600 }}>{text.title}</b>
        </div>
        <div className="fchips" role="group" aria-label={text.chipsLabel}>
          {keywords.map((k) => {
            const dup = owned.has(k.toLowerCase());
            const on = !dup && !off.has(k);
            return (
              <button
                key={k}
                type="button"
                className="chip"
                aria-pressed={on}
                disabled={dup}
                data-tip={dup ? text.already : undefined}
                onClick={() => {
                  setOff((cur) => {
                    const next = new Set(cur);
                    if (on) {
                      next.add(k);
                    } else {
                      next.delete(k);
                    }
                    return next;
                  });
                }}
              >
                {on ? <Icon name="check" size={12} /> : null}
                {k}
              </button>
            );
          })}
        </div>
        {state.dropped > 0 ? <p className="hint">{text.dropped(state.dropped)}</p> : null}
        {failed ? <p className="hint kw-bad">{text.addFailed}</p> : null}
        <div className="row">
          <Btn
            size="sm"
            kind="pri"
            icon="plus"
            disabled={picked.length === 0 || busy}
            onClick={() => {
              void add();
            }}
          >
            {text.addSelected(picked.length)}
          </Btn>
        </div>
      </>
    );
  }

  return (
    <div className="ai-read">
      {body}
      <div className="row">
        <Btn size="sm" kind="ghost" onClick={onClose}>
          {text.close}
        </Btn>
      </div>
    </div>
  );
}
