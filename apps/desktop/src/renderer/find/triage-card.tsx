import { formatCount, isGold, type CatalogItem, type Fit } from "@gratovo/core/find";
import type { RejectReason } from "@gratovo/core/data";
import { Btn, Icon, Tag } from "@gratovo/ui";
import { useEffect, useRef, useState } from "react";

import { ago } from "../lib/format";
import { strings } from "../strings";
import { FitChip } from "./fit-chip";
import { Thumb, ThumbAvatar } from "./thumb";

const text = strings.findTriage;

/** The four reasons, in the order of the 1 to 4 keys. */
export const rejectReasons: readonly RejectReason[] = ["ai", "views", "posting", "audience"];

/** How many sponsor tags show before "+n". */
const sponsorTags = 3;

export type TriageItem = CatalogItem & { readonly fit: Fit };

function Stat({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

export interface TriageCardProps {
  readonly item: TriageItem;
  readonly now: number;
  /** Whether the reason row is open (the R key or its button). */
  readonly reasonOpen: boolean;
  readonly onReasonOpen: (open: boolean) => void;
  readonly onShortlist: () => void;
  readonly onReject: (reason: RejectReason) => void;
  readonly onNever: (reason: string) => void;
  readonly onOpen: () => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}

/** One channel to decide on: its latest videos, numbers, sponsors and fit, then the buttons. */
export function TriageCard({
  item,
  now,
  reasonOpen,
  onReasonOpen,
  onShortlist,
  onReject,
  onNever,
  onOpen,
  onPrev,
  onNext,
}: TriageCardProps) {
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const askRef = useRef<HTMLInputElement>(null);
  // The reason field opens under the person's hands: focus it when it appears.
  useEffect(() => {
    if (asking) {
      askRef.current?.focus();
    }
  }, [asking]);
  const numbers = item.hasNumbers;
  const sponsors = item.sponsors.slice(0, sponsorTags);
  const more = item.sponsors.length - sponsors.length;
  const before = item.emailedBefore;
  const who = before?.who ?? null;
  const beforeAt = before?.at ?? null;
  const when = beforeAt === null ? null : ago(beforeAt, now);
  const closeNever = (): void => {
    setMenu(false);
    setAsking(false);
    setWhy("");
  };
  const confirmNever = (): void => {
    onNever(why.trim());
    closeNever();
  };

  return (
    <>
      <article className="card" style={{ gap: "14px" }} aria-label={item.name}>
        {item.videos.length === 0 ? (
          <p className="hint">{text.noVideos}</p>
        ) : (
          <div className="grid3" style={{ gap: "10px" }} aria-label={text.latestVideos}>
            {item.videos.slice(0, 3).map((v) => (
              <div className="vid" key={v.id}>
                <Thumb pic={v.pic} alt={v.title} name={item.name} />
                <b title={v.title}>{v.title}</b>
                <small>
                  {v.views === null ? text.viewsHidden : text.views(formatCount(v.views))}
                  {v.publishedAt === null ? "" : ` · ${ago(v.publishedAt, now)}`}
                </small>
              </div>
            ))}
          </div>
        )}
        <div className="row top" style={{ gap: "12px" }}>
          <ThumbAvatar pic={item.pic} name={item.name} alt={text.picture(item.name)} />
          <div className="grow col t2 tr-name">
            <h2>{item.name}</h2>
            <span className="muted">
              {item.handle} ·{" "}
              {item.subscribers === null
                ? text.subscribersHidden
                : text.subscribers(formatCount(item.subscribers))}
            </span>
          </div>
          <FitChip fit={item.fit} />
        </div>
        {before === null ? null : (
          <div className="callout warn" role="note">
            <Icon name="users" />
            <span className="grow">
              <b>{text.emailedBefore(who, when)}</b> {text.emailedBeforeNote}
            </span>
          </div>
        )}
        <div className="stats">
          <Stat
            value={numbers ? formatCount(item.medianViews) : text.unknown}
            label={text.medianViews}
          />
          <Stat value={numbers ? String(item.uploads30) : text.unknown} label={text.uploads30} />
          <Stat value={item.country ?? text.unknown} label={text.country} />
          <Stat
            value={item.latestUploadAt === null ? text.unknown : ago(item.latestUploadAt, now)}
            label={text.latestUpload}
          />
        </div>
        <div className="tr-tags">
          {isGold(item) ? (
            <span data-tip={text.goldTip}>
              <Tag tone="good" icon="star">
                {text.goldTag}
              </Tag>
            </span>
          ) : null}
          {sponsors.map((s) => (
            <Tag key={s} tone="info">
              {s}
            </Tag>
          ))}
          {more > 0 ? <Tag>{text.sponsorsMore(more)}</Tag> : null}
          {item.sponsors.length === 0 ? (
            <span className="small muted">{text.sponsorsNone}</span>
          ) : null}
        </div>
        <div className="tr-foot small muted">
          <span>{item.foundEmails > 0 ? text.emailsFound(item.foundEmails) : text.emailsNone}</span>
          {item.keyword === null ? null : <span>{text.foundBy(item.keyword)}</span>}
        </div>
      </article>
      <div className="actionbar">
        <Btn kind="pri" icon="check" kbd="S" onClick={onShortlist}>
          {text.shortlist}
        </Btn>
        <Btn
          icon="x"
          kbd="R"
          onClick={() => {
            onReasonOpen(!reasonOpen);
          }}
        >
          {text.reject}
        </Btn>
        <Btn
          kind="ghost"
          icon="more"
          label={text.more}
          onClick={() => {
            if (menu) {
              closeNever();
            } else {
              setMenu(true);
            }
          }}
        />
        <span className="sp"></span>
        <Btn kind="ghost" icon="arrowL" kbd="←" onClick={onPrev}>
          {text.prev}
        </Btn>
        <Btn kind="ghost" icon="arrowR" kbd="→" onClick={onNext}>
          {text.next}
        </Btn>
        <Btn kind="ghost" icon="eye" kbd="O" onClick={onOpen}>
          {text.open}
        </Btn>
        {reasonOpen ? (
          <div className="reasons" role="group" aria-label={text.rejectWhy}>
            <span className="small muted">{text.rejectWhy}</span>
            {rejectReasons.map((reason, i) => (
              <Btn
                key={reason}
                size="sm"
                kbd={String(i + 1)}
                onClick={() => {
                  onReject(reason);
                }}
              >
                {strings.findActions.reasons[reason]}
              </Btn>
            ))}
          </div>
        ) : null}
        {menu ? (
          asking ? (
            <form
              className="never-form"
              onSubmit={(e) => {
                e.preventDefault();
                confirmNever();
              }}
            >
              <input
                value={why}
                maxLength={200}
                placeholder={text.neverReason}
                aria-label={text.neverReason}
                ref={askRef}
                onChange={(e) => {
                  setWhy(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeNever();
                  }
                }}
              />
              <Btn kind="pri" size="sm" onClick={confirmNever}>
                {text.neverConfirm}
              </Btn>
              <Btn size="sm" kind="ghost" onClick={closeNever}>
                {text.neverCancel}
              </Btn>
            </form>
          ) : (
            <div className="reasons">
              <Btn
                size="sm"
                icon="x"
                onClick={() => {
                  setAsking(true);
                }}
              >
                {text.never}
              </Btn>
            </div>
          )
        ) : null}
      </div>
    </>
  );
}
