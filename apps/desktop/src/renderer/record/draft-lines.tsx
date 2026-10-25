import type { MailboxView, OutreachDraft } from "@gratovo/core/data";
import { findMailbox, mailboxGate } from "@gratovo/core/reach";
import { Icon, Tag } from "@gratovo/ui";

import { setDraftMailbox } from "../lib/reach-actions";
import { useApp } from "../lib/store";
import { toast } from "../lib/toast";
import { strings } from "../strings";

const text = strings.reach.card;

/** The suffix a mailbox gets in the picker when it can't send now. */
function suffix(mailbox: MailboxView): string {
  if (mailbox.signedOut) {
    return ` ${text.signedOutSuffix}`;
  }
  if (mailbox.paused) {
    return ` ${text.pausedSuffix}`;
  }
  return mailboxGate(mailbox) === "mailbox_full" ? ` ${text.fullSuffix}` : "";
}

async function copy(address: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(address);
    toast({ msg: text.copied, icon: "copy", ms: 2500 });
  } catch {
    // Copying is a convenience: with no clipboard there is nothing to say.
  }
}

/** Who the email goes to: the reader's name, the address, whether it is confirmed, and a copy button. */
export function ToLine({ draft }: { readonly draft: OutreachDraft }) {
  const creator = useApp((s) => s.data.creators.find((c) => c.id === draft.creator));
  if (creator === undefined) {
    return null;
  }
  const address = creator.email;
  return (
    <div className="dline">
      <span>{text.to}</span>
      <span className="row" style={{ gap: "6px", minWidth: 0 }}>
        <b className="ell" style={{ fontWeight: 500 }}>
          {creator.contactName ?? creator.name}
        </b>
        <span className="mono small ell muted">{address ?? text.noAddress}</span>
        {creator.emailConfirmed ? (
          <Tag tone="good" icon="check">
            {text.confirmed}
          </Tag>
        ) : (
          <Tag tone="warn" icon="alert">
            {text.notConfirmed}
          </Tag>
        )}
        {address === null ? null : (
          <button
            type="button"
            className="iconbtn"
            style={{ width: "26px", height: "26px" }}
            aria-label={text.copy}
            data-tip={text.copy}
            onClick={() => {
              void copy(address);
            }}
          >
            <Icon name="copy" size={14} />
          </button>
        )}
      </span>
    </div>
  );
}

/** Which mailbox it goes from, with its sends left today. Only a first email can change it (D3). */
export function FromLine({ draft }: { readonly draft: OutreachDraft }) {
  const mailboxes = useApp((s) => s.data.reach.mailboxes);
  const mailbox = findMailbox(mailboxes, draft.mailbox);
  const editable = draft.kind === "first" && (draft.state === "ready" || draft.state === "failed");
  const left = mailbox === null ? 0 : Math.max(0, mailbox.leftToday);
  const cap = mailbox === null ? 1 : Math.max(1, mailbox.effectiveCap);
  const used = mailbox === null ? 0 : Math.min(mailbox.sentToday, cap);
  return (
    <div className="dline">
      <span>{text.from}</span>
      <span className="row wrap" style={{ gap: "6px 8px", minWidth: 0 }}>
        <select
          className="sel sm"
          style={{ width: "auto", maxWidth: "100%" }}
          value={draft.mailbox ?? ""}
          disabled={!editable}
          data-tip={draft.kind === "first" ? undefined : text.sameMailbox}
          aria-label={text.sendFrom}
          onChange={(event) => {
            setDraftMailbox(draft.id, event.target.value);
          }}
        >
          {mailbox === null ? <option value="">{text.noMailbox}</option> : null}
          {mailboxes.map((m) => (
            <option key={m.address} value={m.address}>
              {m.address}
              {suffix(m)}
            </option>
          ))}
        </select>
        {mailbox === null ? null : (
          <>
            <span
              className={`meter ${left <= 3 ? "crit" : left <= 8 ? "warn" : ""}`}
              style={{ width: 64 }}
              role="meter"
              aria-label={text.usedToday}
              aria-valuemin={0}
              aria-valuemax={cap}
              aria-valuenow={used}
            >
              <i style={{ width: `${String((100 * used) / cap)}%` }}></i>
            </span>
            <span className="small muted num" style={{ whiteSpace: "nowrap" }}>
              {text.leftToday(left)}
            </span>
            {mailbox.signedOut ? (
              <Tag tone="crit" icon="alert">
                {text.signedOut}
              </Tag>
            ) : mailbox.paused ? (
              <Tag icon="pause">{text.pausedTag}</Tag>
            ) : mailbox.status === "warming" && mailbox.warmup !== null ? (
              <Tag tone="warn">{text.warming(mailbox.warmup.day, mailbox.warmup.of)}</Tag>
            ) : mailbox.status === "slowed" ? (
              <Tag tone="warn">{text.slowed}</Tag>
            ) : null}
          </>
        )}
      </span>
    </div>
  );
}
