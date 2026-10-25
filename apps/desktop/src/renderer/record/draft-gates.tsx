import type { OutreachDraft } from "@gratovo/core/data";
import { mailboxGate } from "@gratovo/core/reach";
import type { Gate } from "@gratovo/core/reach";
import { Btn, Icon } from "@gratovo/ui";

import { ContactBlock } from "../find/contact-block";
import { confirmGate, gateText, setDraftMailbox } from "../lib/reach-actions";
import { go, useApp } from "../lib/store";
import { strings } from "../strings";
import { confirmHeldAddress } from "./draft-actions";
import { useCreatorItem } from "./use-creator-item";

const text = strings.reach.card;

/** The address picker of the unconfirmed gate: Find's own block when the channel is in the catalog, else the held address. */
function AddressPicker({ draft }: { readonly draft: OutreachDraft }) {
  const creator = useApp((s) => s.data.creators.find((c) => c.id === draft.creator));
  const { item } = useCreatorItem(draft.creator);
  if (item !== null) {
    return <ContactBlock item={item} startOpen />;
  }
  if (creator === undefined) {
    return null;
  }
  return (
    <div className="row wrap">
      {creator.email === null ? (
        <Btn
          size="sm"
          onClick={() => {
            go("find", "contacts");
          }}
        >
          {text.addressOther}
        </Btn>
      ) : (
        <>
          <span className="mono small">{creator.email}</span>
          <Btn
            size="sm"
            kind="pri"
            icon="check"
            onClick={() => {
              confirmHeldAddress(creator);
            }}
          >
            {text.addressConfirm}
          </Btn>
        </>
      )}
    </div>
  );
}

/** One gate: what holds the email and the way to clear it. */
function GateRow({ draft, gate }: { readonly draft: OutreachDraft; readonly gate: Gate }) {
  const mailboxes = useApp((s) => s.data.reach.mailboxes);
  const words = gateText(gate, draft);
  if (gate.key === "unconfirmed") {
    return (
      <div className="gate" data-ui="reach.draft.gate">
        <Icon name="alert" />
        <div className="grow col tight" style={{ gap: "6px" }}>
          <span>{words}</span>
          <AddressPicker draft={draft} />
        </div>
      </div>
    );
  }
  const other =
    gate.key.startsWith("mailbox_") || gate.key === "no_mailbox"
      ? mailboxes
          .filter((m) => m.address !== draft.mailbox && mailboxGate(m) === null)
          .sort((a, b) => b.leftToday - a.leftToday)[0]
      : undefined;
  const blocking =
    gate.key === "blocked" ? (draft.proposal?.findings ?? []).filter((f) => f.blocking) : [];
  return (
    <div className={gate.key === "never" ? "gate block" : "gate"} data-ui="reach.draft.gate">
      <Icon name="alert" />
      <div className="grow col tight" style={{ gap: "4px" }}>
        <span>{words}</span>
        {blocking.length > 0 ? (
          <ul className="small" style={{ margin: 0, paddingInlineStart: "18px" }}>
            {blocking.map((f) => (
              <li key={`${f.rule}-${f.text}`}>{f.text}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {gate.key === "engine" && gate.engine !== null ? (
        <Btn
          size="sm"
          onClick={() => {
            if (gate.engine !== null) {
              confirmGate(draft.id, gate.engine.key);
            }
          }}
        >
          {text.gateConfirm}
        </Btn>
      ) : null}
      {other !== undefined && draft.kind === "first" ? (
        <Btn
          size="sm"
          onClick={() => {
            setDraftMailbox(draft.id, other.address);
          }}
        >
          {text.sendInstead(other.address)}
        </Btn>
      ) : null}
    </div>
  );
}

/** The open gates of a draft, in order. */
export function DraftGates({
  draft,
  gates,
}: {
  readonly draft: OutreachDraft;
  readonly gates: readonly Gate[];
}) {
  if (gates.length === 0) {
    return null;
  }
  return (
    <div className="col tight">
      {gates.map((gate) => (
        <GateRow key={`${gate.key}-${gate.engine?.key ?? ""}`} draft={draft} gate={gate} />
      ))}
    </div>
  );
}
