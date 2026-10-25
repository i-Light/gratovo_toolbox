import type { MailboxView } from "@gratovo/core/data";
import { capMax, capMin, capSteps, isOpenDraft } from "@gratovo/core/reach";
import { Btn, cx, Empty, Icon, Tag } from "@gratovo/ui";
import type { IconName } from "@gratovo/ui";
import { useEffect, useState } from "react";

import { sendTest, setMailbox } from "../lib/reach-actions";
import { go, useApp } from "../lib/store";
import { strings } from "../strings";

const text = strings.reach.mailboxes;

const localPart = (address: string): string => address.split("@")[0] ?? address;

type MailboxPatch = { readonly dailyCap?: number; readonly paused?: boolean };
/** How long a set waits for main's new numbers before the controls come back anyway. */
const settleMs = 3000;

const statusTag: Record<
  MailboxView["status"],
  { readonly tone?: "crit" | "good" | "info" | "warn"; readonly icon: IconName }
> = {
  signed_out: { tone: "crit", icon: "alert" },
  paused: { icon: "pause" },
  slowed: { tone: "warn", icon: "alert" },
  warming: { tone: "info", icon: "timer" },
  good: { tone: "good", icon: "check" },
};

function Meter({
  value,
  max,
  tone,
  label,
}: {
  readonly value: number;
  readonly max: number;
  readonly tone: "crit" | "warn" | "";
  readonly label: string;
}) {
  const top = Math.max(max, 1);
  return (
    <span
      className={`meter ${tone}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={top}
      aria-valuenow={Math.min(value, top)}
    >
      <i style={{ width: `${String(Math.min(100, (100 * value) / top))}%` }}></i>
    </span>
  );
}

/** The bounce rate's colour: warn from 2%, crit from 3%. */
function bounceTone(rate: number | null): "crit" | "warn" | "" {
  return rate === null ? "" : rate >= 3 ? "crit" : rate >= 2 ? "warn" : "";
}

function Stat({
  label,
  rate,
  tone,
  tip,
  emptyTip,
}: {
  readonly label: string;
  readonly rate: number | null;
  readonly tone: "crit" | "warn" | "";
  readonly tip: string;
  readonly emptyTip: string;
}) {
  return (
    <div className={cx("rc-ms", tone)} data-tip={rate === null ? emptyTip : tip}>
      <b>{rate === null ? text.noRate : text.rate(rate)}</b>
      <small>{label}</small>
    </div>
  );
}

function MailCard({ mailbox: m }: { readonly mailbox: MailboxView }) {
  const queued = useApp(
    (s) =>
      s.data.reach.drafts.filter(
        (d) =>
          isOpenDraft(d) &&
          d.mailbox !== null &&
          d.mailbox.toLowerCase() === m.address.toLowerCase(),
      ).length,
  );
  // A set is in flight until main's new numbers show here (they arrive by `reach:changed`, after
  // main's answer), so a fast second click never builds on the old value. A failed set, or numbers
  // that never come, let go.
  const [wanted, setWanted] = useState<MailboxPatch | null>(null);
  const shown =
    wanted !== null &&
    (wanted.dailyCap === undefined || wanted.dailyCap === m.dailyCap) &&
    (wanted.paused === undefined || wanted.paused === m.paused);
  useEffect(() => {
    if (wanted === null) {
      return undefined;
    }
    // Once shown, let go on the next tick; otherwise after `settleMs`.
    const timer = setTimeout(
      () => {
        setWanted(null);
      },
      shown ? 0 : settleMs,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [wanted, shown]);
  const setting = wanted !== null && !shown;
  const name = localPart(m.address);
  const steps = capSteps(m.dailyCap);
  const signedOut = m.status === "signed_out";
  const tag = statusTag[m.status];
  const left = Math.max(0, m.leftToday);
  const set = (patch: MailboxPatch): void => {
    setWanted(patch);
    void setMailbox(m.address, patch).then((ok) => {
      if (!ok) {
        setWanted(null);
      }
    });
  };
  return (
    <div
      className="card"
      style={{ opacity: m.paused ? 0.78 : 1 }}
      data-ui="reach.mailbox"
      role="group"
      aria-label={m.address}
    >
      <div className="card-h">
        <h3 className="mono ell" style={{ fontSize: ".95rem" }}>
          {m.address}
        </h3>
        <Tag {...(tag.tone === undefined ? {} : { tone: tag.tone })} icon={tag.icon}>
          {text.status[m.status]}
        </Tag>
      </div>
      {signedOut ? (
        <div className="gate block">
          <Icon name="alert" />
          <span className="grow">{text.signedOutLine}</span>
          <Btn
            size="sm"
            kind="pri"
            icon="mail"
            onClick={() => {
              go("settings", "connections");
            }}
          >
            {text.signIn}
          </Btn>
        </div>
      ) : null}
      <div className="col tight" style={{ gap: "8px" }}>
        <div className="rc-mrow">
          <span className="ink2">{text.sentToday}</span>
          <Meter
            value={m.sentToday}
            max={m.effectiveCap}
            tone={m.paused ? "" : left <= 3 ? "crit" : left <= 8 ? "warn" : ""}
            label={text.sentTodayMeter(name)}
          />
          <span className="num">{text.sentOf(m.sentToday, m.effectiveCap)}</span>
        </div>
        <div className="rc-mrow">
          <span className="ink2">{text.warmup}</span>
          {m.warmup === null ? (
            <>
              <span className="muted">{text.warmupDone}</span>
              <span></span>
            </>
          ) : (
            <>
              <Meter value={m.warmup.day} max={m.warmup.of} tone="" label={text.warmupMeter} />
              <span className="num">{text.warmupDay(m.warmup.day, m.warmup.of)}</span>
            </>
          )}
        </div>
      </div>
      <div className="rc-mstats">
        <Stat
          label={text.bounces}
          rate={m.bounceRate}
          tone={bounceTone(m.bounceRate)}
          tip={text.bouncesTip}
          emptyTip={text.noBounceTip}
        />
        <Stat
          label={text.replies}
          rate={m.replyRate}
          tone=""
          tip={text.repliesTip}
          emptyTip={text.noReplyTip}
        />
      </div>
      <div className="row wrap" style={{ gap: "10px" }}>
        <span className="ink2" style={{ fontSize: "12.5px" }}>
          {text.dailyLimit}
        </span>
        <div className="seg" role="group" aria-label={text.limitGroup(name)}>
          <button
            type="button"
            aria-label={text.lower}
            disabled={steps.down === null || setting}
            data-tip={steps.down === null ? text.atLeast(capMin) : undefined}
            onClick={() => {
              if (steps.down !== null) {
                set({ dailyCap: steps.down });
              }
            }}
          >
            <Icon name="minus" size={14} />
          </button>
          <span className="rc-step" style={{ alignSelf: "center" }}>
            {m.dailyCap}
          </span>
          <button
            type="button"
            aria-label={text.raise}
            disabled={steps.up === null || setting}
            data-tip={steps.up === null ? text.atMost(capMax) : undefined}
            onClick={() => {
              if (steps.up !== null) {
                set({ dailyCap: steps.up });
              }
            }}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>
      {m.status === "slowed" ? (
        <span className="hint">{text.slowedHint(m.dailyCap)}</span>
      ) : m.status === "warming" ? (
        <span className="hint">{text.warmingHint(m.dailyCap)}</span>
      ) : null}
      <div className="row wrap">
        <Btn
          size="sm"
          icon="mail"
          disabled={m.paused || signedOut}
          tip={signedOut ? text.testTipSignedOut : m.paused ? text.testTipPaused : text.testTip}
          onClick={() => {
            void sendTest(m.address);
          }}
        >
          {text.test}
        </Btn>
        <Btn
          size="sm"
          {...(m.paused ? { kind: "pri" } : {})}
          icon={m.paused ? "play" : "pause"}
          disabled={setting}
          onClick={() => {
            set({ paused: !m.paused });
          }}
        >
          {m.paused ? text.resume : text.pause}
        </Btn>
        <span className="sp"></span>
        {queued > 0 ? <span className="small muted num">{text.queued(queued)}</span> : null}
      </div>
    </div>
  );
}

/** Reach › Mailboxes (D20): one card per sending mailbox, with its health, limit and test. */
export function Mailboxes() {
  const mailboxes = useApp((s) => s.data.reach.mailboxes);
  if (mailboxes.length === 0) {
    return (
      <div className="card">
        <Empty
          icon="mail"
          title={text.emptyTitle}
          action={
            <Btn
              size="sm"
              onClick={() => {
                go("settings", "connections");
              }}
            >
              {text.emptyAction}
            </Btn>
          }
        >
          {text.emptyHint}
        </Empty>
      </div>
    );
  }
  const slowed = mailboxes
    .filter((m) => m.status === "slowed")
    .map((m) => text.slowedPart(localPart(m.address), m.bounceRate));
  return (
    <div className="col" data-ui="reach.mailboxes">
      <div className="callout info" role="note">
        <Icon name="gauge" />
        {/* A zero basis keeps the long text beside the icon instead of wrapping under it. */}
        <div className="grow" style={{ flexBasis: 0 }}>
          <b style={{ fontWeight: 600 }}>{text.ruleLead}</b>
          {text.ruleBody}
          {slowed.length > 0 ? text.rightNow(slowed) : ""}
        </div>
      </div>
      <div className="rc-mgrid">
        {mailboxes.map((m) => (
          <MailCard key={m.address} mailbox={m} />
        ))}
      </div>
    </div>
  );
}
