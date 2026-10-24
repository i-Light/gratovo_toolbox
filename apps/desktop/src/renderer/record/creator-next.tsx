import { Btn, Icon } from "@gratovo/ui";
import { useState, type CSSProperties, type ReactNode } from "react";

import { ContactBlock } from "../find/contact-block";
import { rejectReasons } from "../find/triage-card";
import { allowAgain, bringBack, reject, shortlist } from "../lib/find-actions";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import type { CreatorDetail } from "./detail";

const text = strings.creatorRecord;

/**
 * The one next step for a channel, by its stage (D23): what is next in a line and one button. New:
 * Shortlist, with a quieter Reject and its reason picker. Shortlisted: Confirm an address opens the contact block here (5c). Contact: the confirmed address and
 * its reader, with Change. Rejected: Bring back. Never: Allow again, after a yes. Later stages: the stage
 * name only, because Reach is a later step.
 */
export function CreatorNext({ item }: { readonly item: CreatorDetail }) {
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // The page's own creator holds the address once it is confirmed (it leads main's catalog).
  const creator = useApp((s) => s.data.creators.find((c) => c.id === item.id));
  const email = creator?.email ?? item.email;
  const readerName = creator === undefined ? item.contactName : creator.contactName;
  const stage = item.stage;
  let line: string;
  let hint: string | null = null;
  let actions: ReactNode = null;
  if (stage === "new") {
    line = text.next.newLine;
    actions = (
      <>
        <Btn
          kind="pri"
          size="sm"
          icon="check"
          onClick={() => {
            shortlist([item]);
          }}
        >
          {text.shortlist}
        </Btn>
        <Btn
          kind="ghost"
          size="sm"
          icon="x"
          onClick={() => {
            setPicking(!picking);
          }}
        >
          {text.reject}
        </Btn>
      </>
    );
  } else if (stage === "shortlisted") {
    line = text.next.shortlistedLine;
    hint = text.next.confirmHint;
    actions = (
      <Btn
        kind="pri"
        size="sm"
        icon="mail"
        onClick={() => {
          setConfirming(!confirming);
        }}
      >
        {text.next.confirmAddress}
      </Btn>
    );
  } else if (stage === "contact" && email !== null) {
    line = text.next.contactConfirmed(email);
    hint = text.next.contactHint(readerName);
    actions = (
      <Btn
        size="sm"
        kind="ghost"
        onClick={() => {
          setConfirming(!confirming);
        }}
      >
        {strings.findContacts.block.change}
      </Btn>
    );
  } else if (stage === "rejected") {
    line =
      item.rejectReason === null
        ? text.next.rejectedNoReason
        : text.next.rejectedLine(strings.findActions.reasons[item.rejectReason]);
    actions = (
      <Btn
        size="sm"
        icon="undo"
        onClick={() => {
          bringBack(item);
        }}
      >
        {text.bringBack}
      </Btn>
    );
  } else if (stage === "never") {
    line = text.next.neverLine;
    hint = text.next.neverHint;
    actions = asking ? (
      <>
        <span className="small">{text.next.allowSure}</span>
        <Btn
          kind="pri"
          size="sm"
          onClick={() => {
            allowAgain(item);
            setAsking(false);
          }}
        >
          {text.next.allowYes}
        </Btn>
        <Btn
          kind="ghost"
          size="sm"
          onClick={() => {
            setAsking(false);
          }}
        >
          {text.next.allowKeep}
        </Btn>
      </>
    ) : (
      <Btn
        size="sm"
        onClick={() => {
          setAsking(true);
        }}
      >
        {text.next.allow}
      </Btn>
    );
  } else {
    line = strings.record.stages[stage];
    hint = text.next.laterHint;
  }
  return (
    <div className="nextcard" style={{ "--hue": "var(--find)" } as CSSProperties}>
      <Icon name="flag" />
      <span className="nt">
        <b style={{ fontWeight: 600 }}>{line}</b>
        {hint === null ? null : <small>{hint}</small>}
      </span>
      {actions === null ? null : <span className="nx">{actions}</span>}
      {confirming && (stage === "shortlisted" || stage === "contact") ? (
        <div style={{ flexBasis: "100%" }}>
          <ContactBlock
            item={item}
            startOpen={stage === "contact"}
            onDone={() => {
              setConfirming(false);
            }}
          />
        </div>
      ) : null}
      {picking && stage === "new" ? (
        <span className="nx" role="group" aria-label={text.rejectWhy} style={{ flexBasis: "100%" }}>
          <span className="small muted">{text.rejectWhy}</span>
          {rejectReasons.map((reason) => (
            <Btn
              key={reason}
              size="sm"
              onClick={() => {
                reject([item], reason);
                setPicking(false);
              }}
            >
              {strings.findActions.reasons[reason]}
            </Btn>
          ))}
        </span>
      ) : null}
    </div>
  );
}
