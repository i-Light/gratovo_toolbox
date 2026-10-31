import { DEAL_FLOW } from "@gratovo/core";
import {
  creatorOverviewBlocks,
  type CreatorOverviewBlock,
  type OverviewFacts,
} from "@gratovo/core/data";
import { formatCount, uploadsUnread } from "@gratovo/core/find";
import { isOpenDraft } from "@gratovo/core/reach";
import { Btn, Tag } from "@gratovo/ui";
import type { ReactNode } from "react";

import { ago, money, shortDate, unreadWords } from "../lib/format";
import { useApp } from "../lib/store";
import { useNow } from "../lib/use-now";
import { isPartShown } from "../lib/wired";
import { strings } from "../strings";
import { CreatorAudience } from "./creator-audience";
import { SequenceLine } from "./creator-emails";
import { FitSection, Stat, VideosSection } from "./creator-overview";
import type { CreatorDetail } from "./detail";
import { useOpenTab } from "./record-shell";

const text = strings.creatorRecord;
const o = text.overview;
const numbers = text.numbers;

/** The numbers that decide, or only the short three. An unread channel shows what is known. */
function Numbers({ item, short }: { readonly item: CreatorDetail; readonly short: boolean }) {
  if (!item.hasNumbers) {
    return <p className="hint">{text.noNumbers}</p>;
  }
  const unread = uploadsUnread(item);
  const median = unread
    ? unreadWords(item.medianViews > 0 ? formatCount(item.medianViews) : null, item.readFailed)
    : formatCount(item.medianViews);
  const uploads = unread
    ? unreadWords(item.uploads30 > 0 ? String(item.uploads30) : null, item.readFailed)
    : String(item.uploads30);
  return (
    <div className="stats" data-ui="record.overview.stats">
      <Stat
        value={item.subscribers === null ? numbers.hidden : formatCount(item.subscribers)}
        label={numbers.subscribers}
      />
      <Stat value={median} label={numbers.median} muted={unread} />
      {short ? null : (
        <Stat
          value={item.trimmedAverage === null ? numbers.unknown : formatCount(item.trimmedAverage)}
          label={
            item.viewStability === null
              ? o.trimmed
              : `${o.trimmed}, ${item.viewStability === "stable" ? o.stable : o.volatile}`
          }
          muted={item.trimmedAverage === null}
        />
      )}
      <Stat value={uploads} label={numbers.uploads} muted={unread} />
      {short ? null : (
        <Stat
          value={item.engagement === null ? numbers.unknown : o.engagementValue(item.engagement)}
          label={o.engagement}
          muted={item.engagement === null}
        />
      )}
    </div>
  );
}

function Block({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="cr-block">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

/** The stage-aware Overview (R3): `creatorOverviewBlocks` says which blocks, in which order. */
export function CreatorOverview({ item }: { readonly item: CreatorDetail }) {
  const now = useNow();
  const openTab = useOpenTab();
  const creator = useApp((s) => s.data.creators.find((c) => c.id === item.id));
  const summary = useApp((s) => s.data.reach.threads.find((t) => t.creator === item.id));
  const hasSequence = useApp((s) => s.data.reach.sequences.some((q) => q.creator === item.id));
  const waiting = useApp((s) =>
    s.data.reach.drafts.find((d) => d.creator === item.id && isOpenDraft(d)),
  );
  const allDeals = useApp((s) => s.data.deals);
  const seesMoney = useApp((s) => s.data.seesMoney);
  const source = useApp((s) => s.data.source);
  const mine = isPartShown("record.deals", source)
    ? allDeals.filter((d) => d.creator === item.id)
    : [];
  const details = creator?.details;
  const relationship = details?.relationship ?? null;
  const onboarding = details?.onboarding ?? null;
  const email = creator?.email ?? item.email;
  const confirmed = creator?.emailConfirmed ?? item.emailConfirmed;
  const reader = creator === undefined ? item.contactName : creator.contactName;
  const lastIn = summary?.lastIn ?? null;
  const reply = lastIn !== null && !lastIn.bounce ? lastIn : null;
  const rate = creator?.kit?.rate ?? null;
  const bot = item.botRisk !== null && item.botRisk.level !== "clean" ? item.botRisk : null;
  const facts: OverviewFacts = {
    hasReason: item.stage === "rejected" ? item.rejectReason !== null : item.stage === "never",
    hasWarnings: bot !== null || item.format === "shorts",
    hasContact: confirmed && email !== null,
    hasEmails: (summary !== undefined && summary.count > 0) || hasSequence,
    hasReply: reply !== null,
    hasDraft: waiting !== undefined,
    hasRelationship: relationship !== null,
    hasUpdate:
      details !== undefined && (details.lastUpdateAt !== null || details.nextOpenSlot !== null),
    hasLocks: (details?.locks.length ?? 0) > 0,
    hasOnboarding: onboarding !== null,
    hasDeals: mine.length > 0,
    hasRate: rate !== null,
    seesMoney,
  };
  const blocks = creatorOverviewBlocks(item.stage, facts);
  const render = (block: CreatorOverviewBlock): ReactNode => {
    switch (block) {
      case "numbers":
        return <Numbers item={item} short={false} />;
      case "shortNumbers":
        return <Numbers item={item} short />;
      case "videos":
        return <VideosSection item={item} limit={3} />;
      case "fit":
        return <FitSection item={item} />;
      case "warnings":
        return (
          <Block title={o.warnings}>
            <div className="cr-chips">
              {bot === null ? null : (
                <Tag tone={bot.level === "high" ? "crit" : "warn"} icon="alert">
                  {bot.note === null
                    ? text.header.botRisk[bot.level]
                    : `${text.header.botRisk[bot.level]}: ${bot.note}`}
                </Tag>
              )}
              {item.format === "shorts" ? <Tag tone="warn">{o.shortsChannel}</Tag> : null}
            </div>
          </Block>
        );
      case "reason":
        return (
          <Block title={o.reason}>
            <p>
              {item.stage === "never"
                ? (item.neverReason ?? o.neverNoReason)
                : item.rejectReason === null
                  ? o.neverNoReason
                  : strings.findActions.reasons[item.rejectReason]}
            </p>
          </Block>
        );
      case "contact":
        return (
          <Block title={o.contact}>
            <p>{email === null ? o.contactNone : o.contactLine(email, reader)}</p>
          </Block>
        );
      case "emails":
        return (
          <Block title={o.emails}>
            <p>
              {summary === undefined || summary.count === 0
                ? o.emailsNone
                : o.emailsLine(
                    summary.count,
                    summary.lastOutAt === null ? null : ago(summary.lastOutAt, now),
                  )}
            </p>
            <SequenceLine creatorId={item.id} />
          </Block>
        );
      case "reply":
        return reply === null ? null : (
          <Block title={o.reply}>
            <p>{reply.reading?.summary ?? reply.preview}</p>
            <span className="small muted">
              {o.replyFrom(ago(reply.at, now))}
              {reply.reading === null ? ` · ${o.replyUnread}` : ` · ${reply.reading.label}`}
            </span>
          </Block>
        );
      case "draft":
        return waiting === undefined ? null : (
          <Block title={o.draft}>
            <p>
              {o.draftLine(
                waiting.subject === "" ? strings.reach.emails.draftFirst : waiting.subject,
              )}
            </p>
            <div className="row">
              <Btn
                size="sm"
                icon="mail"
                onClick={() => {
                  openTab("emails");
                }}
              >
                {o.openEmails}
              </Btn>
            </div>
          </Block>
        );
      case "audienceCheck":
        return <CreatorAudience creatorId={item.id} />;
      case "relationship":
        return relationship === null ? null : (
          <Block title={o.relationship}>
            <p>
              <Tag tone="info">{text.header.relationship[relationship]}</Tag>{" "}
              <span className="small muted">{o.relationshipTip[relationship]}</span>
            </p>
          </Block>
        );
      case "update":
        return details === undefined ? null : (
          <Block title={o.update}>
            <p>
              {details.lastUpdateAt === null
                ? o.noUpdate
                : o.lastUpdate(ago(details.lastUpdateAt, now))}
              {" · "}
              {details.nextOpenSlot === null
                ? o.noSlot
                : o.nextSlot(shortDate(details.nextOpenSlot))}
            </p>
          </Block>
        );
      case "locks":
        return (
          <Block title={o.locks}>
            <div className="cr-chips">
              {(details?.locks ?? []).map((l) => (
                <Tag key={`${l.category}${l.brand}`} tone="warn" icon="lock">
                  {o.lockLine(l.category, l.brand, shortDate(l.until))}
                </Tag>
              ))}
            </div>
          </Block>
        );
      case "onboarding":
        return onboarding === null ? null : (
          <Block title={o.onboarding}>
            <dl className="kv">
              <dt>{o.dreamBrands}</dt>
              <dd>{onboarding.dreamBrands.join(", ") || o.none}</dd>
              <dt>{o.hardNos}</dt>
              <dd>{onboarding.hardNos.join(", ") || o.none}</dd>
            </dl>
          </Block>
        );
      case "deals": {
        // A deal at the last step (Next deal) is finished; the rest are in flight.
        const last = DEAL_FLOW.length - 1;
        const open = mine.filter((d) => d.step < last);
        const furthest = Math.max(...open.map((d) => d.step));
        const done = mine.length - open.length;
        return (
          <Block title={o.deals}>
            <p>
              {open.length === 0
                ? o.dealsNone
                : o.dealsLine(open.length, DEAL_FLOW[furthest]?.name ?? strings.record.unknownName)}
              {done > 0 ? o.dealsDone(done) : null}
            </p>
            <div className="row">
              <Btn
                size="sm"
                onClick={() => {
                  openTab("deals");
                }}
              >
                {o.openDeals}
              </Btn>
            </div>
          </Block>
        );
      }
      case "rate":
        return rate === null ? null : (
          <Block title={relationship === "exclusive_25" ? o.rateExclusive : o.rate}>
            <p className="num">{money(rate)}</p>
          </Block>
        );
    }
  };
  if (blocks.length === 0) {
    return <p className="hint">{o.empty}</p>;
  }
  return (
    <>
      {blocks.map((block) => (
        <div key={block} className="col" data-ui={`record.block.${block}`}>
          {render(block)}
        </div>
      ))}
    </>
  );
}
