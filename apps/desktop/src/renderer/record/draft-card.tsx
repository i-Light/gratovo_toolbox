import { rewriteHows } from "@gratovo/core/data";
import type { OutreachDraft } from "@gratovo/core/data";
import {
  canSchedule,
  canSend,
  draftGates,
  findMailbox,
  mondayAt9,
  theirMorning,
  tomorrowAt9,
} from "@gratovo/core/reach";
import { Btn, cx, Icon, IconBtn, Tag } from "@gratovo/ui";
import { useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { openMenu } from "../lib/actions";
import { ago } from "../lib/format";
import {
  dayWords,
  whenWords,
  kindLabel,
  rewriteDraft,
  scheduleDraft,
  sendDraft,
  skipDraft,
} from "../lib/reach-actions";
import { useApp } from "../lib/store";
import { useNow } from "../lib/use-now";
import { strings } from "../strings";
import { DraftGates } from "./draft-gates";
import { AutoText, NeverAsk } from "./draft-parts";
import { FromLine, ToLine } from "./draft-lines";
import { DraftingBody, ProblemCallout, ScheduledNote, SendNote } from "./draft-states";
import { useDraftText } from "./use-draft-text";

const text = strings.reach.card;
const later = strings.reach.later;

function Card({ draft }: { readonly draft: OutreachDraft }) {
  const now = useNow();
  const gemini = useApp((s) => s.data.reach.gemini);
  const creator = useApp((s) => s.data.creators.find((c) => c.id === draft.creator) ?? null);
  const mailbox = useApp((s) => findMailbox(s.data.reach.mailboxes, draft.mailbox));
  const creatorName = creator?.name ?? "";
  const typed = useDraftText(draft);
  const [whyOpen, setWhyOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const gates = draft.state === "ready" ? draftGates({ draft, creator, mailbox }) : [];
  const busy = draft.rewriting !== null;
  const ready = draft.state === "ready";
  const blocked = !canSend(gates);
  const zone = useApp((s) => s.data.reach.zones[draft.creator] ?? null);
  const cannotSchedule = !canSchedule(gates);
  const send = (): void => {
    typed.flush();
    sendDraft(draft.id);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (ready && !busy) {
        send();
      }
    }
  };
  const sendLater = (event: MouseEvent<HTMLButtonElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = Date.now();
    const morning = theirMorning(zone, at);
    const tomorrow = tomorrowAt9(at);
    const monday = mondayAt9(at);
    const pick = (when: number) => (): void => {
      typed.flush();
      scheduleDraft(draft.id, when);
    };
    openMenu(
      box,
      [
        { kind: "heading", label: later.menu },
        {
          kind: "item",
          label: later.theirMorning,
          hint: morning.theirs
            ? later.theirHint(whenWords(morning.at))
            : later.yoursHint(dayWords(morning.at)),
          icon: "sun",
          run: pick(morning.at),
        },
        {
          kind: "item",
          label: later.tomorrow,
          hint: dayWords(tomorrow),
          icon: "clock",
          run: pick(tomorrow),
        },
        {
          kind: "item",
          label: later.monday,
          hint: dayWords(monday),
          icon: "calendar",
          run: pick(monday),
        },
      ],
      later.menu,
      "start",
    );
  };
  const more = (event: MouseEvent<HTMLButtonElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    openMenu(
      box,
      [
        { kind: "item", label: text.skipThis, icon: "arrowR", run: () => skipDraft(draft.id) },
        { kind: "separator" },
        {
          kind: "item",
          label: text.never(creatorName),
          icon: "ban",
          danger: true,
          run: () => {
            setAsking(true);
          },
        },
      ],
      text.more,
      "end",
    );
  };
  const rewriteOff = gemini !== "ready";
  const proposal = draft.proposal;
  return (
    // The group only catches Ctrl+Enter from the fields inside it.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={cx("draft", busy && "rewriting")}
      data-ui="reach.draft"
      role="group"
      aria-label={text.label(kindLabel(draft))}
      onKeyDown={onKey}
    >
      <div className="dh">
        <div className="row">
          <Tag
            icon={draft.kind === "reply" ? "reply" : draft.kind === "followUp" ? "clock" : "send"}
          >
            {kindLabel(draft)}
          </Tag>
          <span className="small muted">
            {text.drafted(ago(draft.createdAt, now))}
            {draft.edited ? ` · ${text.edited}` : ""}
          </span>
          <span className="sp"></span>
          {proposal === null ? null : (
            <Btn
              size="sm"
              kind="ghost"
              icon="sparkle"
              expanded={whyOpen}
              onClick={() => {
                setWhyOpen(!whyOpen);
              }}
            >
              {text.why}
            </Btn>
          )}
        </div>
        <ToLine draft={draft} />
        <FromLine draft={draft} />
      </div>
      <div className="db">
        {draft.state === "drafting" ? (
          <DraftingBody draft={draft} />
        ) : (
          <>
            <ProblemCallout draft={draft} />
            <input
              className="subj"
              value={typed.subject}
              readOnly={busy || !(ready || draft.state === "failed")}
              aria-label={text.subject}
              onChange={(event) => {
                typed.change("subject", event.target.value);
              }}
              onFocus={() => {
                typed.focus("subject");
              }}
              onBlur={typed.blur}
            />
            <AutoText
              value={typed.body}
              label={text.body}
              readOnly={busy || !(ready || draft.state === "failed")}
              onChange={(value) => {
                typed.change("body", value);
              }}
              onFocus={() => {
                typed.focus("body");
              }}
              onBlur={typed.blur}
            />
            {whyOpen && proposal !== null ? (
              <div className="callout info">
                <Icon name="sparkle" />
                <div className="grow col tight" style={{ gap: "6px" }}>
                  <span>{proposal.why}</span>
                  <span className="row wrap" style={{ gap: "4px" }}>
                    {proposal.rules.map((rule) => (
                      <span key={rule} className="tag line mono" data-tip={text.whyRules}>
                        {rule}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            ) : null}
            <DraftGates draft={draft} gates={gates} />
            {asking ? (
              <NeverAsk
                draft={draft}
                onDone={() => {
                  setAsking(false);
                }}
              />
            ) : null}
          </>
        )}
      </div>
      {draft.state === "drafting" ? null : (
        <div className="df">
          {draft.state === "approved" || draft.state === "sending" ? (
            <SendNote draft={draft} />
          ) : draft.state === "scheduled" ? (
            <ScheduledNote draft={draft} />
          ) : (
            <>
              {ready ? (
                <span className="btn-split" data-ui="reach.draft.send">
                  <Btn
                    kind="pri"
                    icon="send"
                    disabled={blocked || busy}
                    tip={blocked ? text.sendBlocked : text.sendTip}
                    kbd={strings.keys.ctrlEnter}
                    onClick={send}
                  >
                    {text.send}
                  </Btn>
                  <Btn
                    kind="pri"
                    label={later.menu}
                    disabled={cannotSchedule || busy}
                    tip={cannotSchedule ? later.menuBlocked : later.menuTip}
                    onClick={sendLater}
                  >
                    <Icon name="chevD" size={14} />
                  </Btn>
                </span>
              ) : null}
              {ready ? (
                <span className="row" style={{ gap: "2px" }} data-ui="reach.draft.rewrite">
                  <span className="small muted" style={{ padding: "0 4px 0 8px" }}>
                    {text.rewrite}
                  </span>
                  {rewriteHows.map((how) => (
                    <Btn
                      key={how}
                      size="sm"
                      kind="ghost"
                      disabled={busy || rewriteOff}
                      {...(rewriteOff ? { tip: text.rewriteOff } : {})}
                      {...(draft.rewriting === how
                        ? { icon: "refresh", iconClassName: "spin" }
                        : {})}
                      onClick={() => {
                        typed.flush();
                        void rewriteDraft(draft.id, how);
                      }}
                    >
                      {text.rewriteChips[how]}
                    </Btn>
                  ))}
                </span>
              ) : null}
              <span className="sp"></span>
              <Btn
                size="sm"
                kind="ghost"
                icon="arrowR"
                tip={text.skipTip}
                onClick={() => {
                  skipDraft(draft.id);
                }}
              >
                {text.skip}
              </Btn>
              <IconBtn icon="more" label={text.more} tip={text.moreTip} onClick={more} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One draft, as the prototype's draft card: header, text, gates and the footer. */
export function DraftCard({ draftId }: { readonly draftId: string }) {
  const draft = useApp((s) => s.data.reach.drafts.find((d) => d.id === draftId));
  return draft === undefined ? null : <Card draft={draft} />;
}
