import type { OutreachDraft } from "@gratovo/core/data";
import { Btn, Icon } from "@gratovo/ui";
import { useState } from "react";

import { markSent, retryDraft, sendAsNew } from "../lib/reach-actions";
import { useNow } from "../lib/use-now";
import { strings } from "../strings";
import { takeBack } from "./draft-actions";

const text = strings.reach.card;

/** A draft Gemini hasn't written yet: grey lines and, when it waits, why. */
export function DraftingBody({ draft }: { readonly draft: OutreachDraft }) {
  const why =
    draft.problem === "bridge_off" || draft.problem === "paused" || draft.problem === "no_sender"
      ? text.draftingWaits[draft.problem]
      : null;
  return (
    <div className="dr-skel" role="status" aria-busy="true">
      <span className="row">
        <Icon name="sparkle" />
        <b>{text.drafting}</b>
      </span>
      {why === null ? null : <span className="small muted">{why}</span>}
      <i style={{ width: "40%" }}></i>
      <i style={{ width: "92%" }}></i>
      <i style={{ width: "86%" }}></i>
      <i style={{ width: "64%" }}></i>
    </div>
  );
}

/**
 * Why a draft is back or failed, with what can be done. A `maybe_sent` draft asks whether it went:
 * "It was sent" records it, "Send as new" asks once more before it sends again.
 */
export function ProblemCallout({ draft }: { readonly draft: OutreachDraft }) {
  const [asking, setAsking] = useState(false);
  const failed = draft.state === "failed";
  if (draft.problem === null && !failed) {
    return null;
  }
  const words = strings.reach.problems[draft.problem ?? "engine_failed"];
  const maybe = draft.problem === "maybe_sent";
  return (
    <div
      className={failed ? "callout crit" : "callout warn"}
      role="alert"
      data-ui="reach.draft.problem"
    >
      <Icon name="alert" />
      <div className="grow col tight" style={{ gap: "6px" }}>
        <span>{words}</span>
        {asking ? (
          <span className="small">
            {text.sendAsNewSure} {text.sendAsNewNote}
          </span>
        ) : null}
        {failed ? (
          <div className="row wrap">
            {maybe && asking ? (
              <>
                <Btn
                  size="sm"
                  kind="pri"
                  onClick={() => {
                    setAsking(false);
                    void sendAsNew(draft.id);
                  }}
                >
                  {text.sendAsNewYes}
                </Btn>
                <Btn
                  size="sm"
                  kind="ghost"
                  onClick={() => {
                    setAsking(false);
                  }}
                >
                  {text.sendAsNewCancel}
                </Btn>
              </>
            ) : maybe ? (
              <>
                <Btn
                  size="sm"
                  onClick={() => {
                    void markSent(draft.id);
                  }}
                >
                  {text.wasSent}
                </Btn>
                <Btn
                  size="sm"
                  onClick={() => {
                    setAsking(true);
                  }}
                >
                  {text.sendAsNew}
                </Btn>
              </>
            ) : (
              <Btn
                size="sm"
                icon="refresh"
                onClick={() => {
                  void retryDraft(draft.id);
                }}
              >
                {text.tryAgain}
              </Btn>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The footer while an email is on its way: the 10 s hold with Undo, then "Sending…". */
export function SendNote({ draft }: { readonly draft: OutreachDraft }) {
  const now = useNow(250);
  if (draft.state === "sending") {
    return (
      <span className="row" role="status">
        <Icon name="refresh" className="spin" />
        <span>{text.sending}</span>
      </span>
    );
  }
  const seconds = Math.max(0, Math.ceil(((draft.sendAt ?? now) - now) / 1000));
  return (
    <span className="row" role="status">
      <span className="num">{text.sendingIn(seconds)}</span>
      <Btn
        size="sm"
        icon="undo"
        onClick={() => {
          void takeBack(draft.id);
        }}
      >
        {text.undo}
      </Btn>
    </span>
  );
}
