import { fitOf, formatCount, isGold, type CatalogItem } from "@gratovo/core/find";
import { cx, Icon, Tag } from "@gratovo/ui";
import { memo, useMemo, useRef, useState, type MouseEvent } from "react";

import { strings } from "../strings";
import { FitChip } from "./fit-chip";
import { Thumb, ThumbAvatar } from "./thumb";

const text = strings.findGallery.card;

/** How many sponsor tags show before "+n". */
const sponsorTags = 2;
const dayMs = 86_400_000;

export interface GalleryCardProps {
  readonly item: CatalogItem;
  readonly selected: boolean;
  /** Whether any card is selected: the select buttons then show on every card. */
  readonly pics: boolean;
  readonly latest: boolean;
  readonly signals: boolean;
  /** Plain click and Enter. */
  readonly onOpen: (id: string) => void;
  /** The select button, and a click with Shift, Ctrl or Cmd. */
  readonly onPick: (id: string, shiftKey: boolean) => void;
}

/** The video line: when it was published, in days. */
function videoAge(at: number | null, now: number): string | null {
  if (at === null) {
    return null;
  }
  const days = Math.max(0, Math.floor((now - at) / dayMs));
  return days === 0 ? text.today : text.daysAgo(days);
}

/**
 * One channel as a card (find.js `Card`). The whole card opens the peek through one stretched
 * button; the select button, the fit chip and the tags sit above it. Moving across the picture
 * flips through the last 3 videos (no animation). Memoised: with a thousand cards loaded, one
 * selection or one hover only draws one card.
 */
export const GalleryCard = memo(function GalleryCard({
  item,
  selected,
  pics,
  latest,
  signals,
  onOpen,
  onPick,
}: GalleryCardProps) {
  const [flip, setFlip] = useState(0);
  const thumbRef = useRef<HTMLDivElement>(null);
  const fit = useMemo(() => fitOf(item), [item]);
  const videos = item.videos.slice(0, 3);
  const index = Math.min(flip, Math.max(0, videos.length - 1));
  const video = videos[index];
  const now = Date.now();
  const stage = strings.record.stages[item.stage];
  const dim = item.stage === "rejected" || item.stage === "never";
  const sponsors = item.sponsors;

  const move = (event: MouseEvent): void => {
    const box = thumbRef.current?.getBoundingClientRect();
    if (box === undefined || videos.length < 2 || box.width <= 0) {
      return;
    }
    if (event.clientY < box.top || event.clientY > box.bottom) {
      if (flip !== 0) setFlip(0);
      return;
    }
    const next = Math.min(
      videos.length - 1,
      Math.max(0, Math.floor((videos.length * (event.clientX - box.left)) / box.width)),
    );
    if (next !== flip) {
      setFlip(next);
    }
  };

  const age = video === undefined ? null : videoAge(video.publishedAt, now);
  return (
    // The pointer flip is an extra; the stretched button inside is the card's real control.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className={cx("gcard", dim && "dim")}
      role="listitem"
      data-selected={selected}
      data-name={item.name}
      onMouseMove={pics ? move : undefined}
      onMouseLeave={
        pics
          ? () => {
              setFlip(0);
            }
          : undefined
      }
    >
      <button
        type="button"
        className="gopen"
        aria-label={text.open(item.name)}
        onClick={(event) => {
          if (event.shiftKey || event.ctrlKey || event.metaKey) {
            onPick(item.id, event.shiftKey);
          } else {
            onOpen(item.id);
          }
        }}
      />
      <button
        type="button"
        className="gsel"
        aria-pressed={selected}
        aria-label={selected ? text.unselect(item.name) : text.select(item.name)}
        onClick={(event) => {
          event.stopPropagation();
          onPick(item.id, event.shiftKey);
        }}
      >
        <Icon name="check" size={13} />
      </button>
      {pics ? (
        <div className="thumbwrap" ref={thumbRef}>
          <Thumb pic={video?.pic ?? null} alt={video?.title ?? text.noVideo} name={item.name} />
          <span className="gstage">
            <Tag>{stage}</Tag>
          </span>
          {videos.length > 1 ? (
            <span className="scrub" aria-hidden="true">
              {videos.map((v, i) => (
                <i key={v.id} className={i === index ? "on" : undefined} />
              ))}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="gb">
        <div className="row gname">
          <ThumbAvatar pic={item.pic} name={item.name} alt={item.name} />
          <span className="grow col t2" style={{ minWidth: 0 }}>
            <b className="ell gtitle-name">{item.name}</b>
            <span className="small muted ell">
              {item.handle} ·{" "}
              {item.subscribers === null ? text.subscribersHidden : formatCount(item.subscribers)}
            </span>
          </span>
          {pics ? null : <Tag>{stage}</Tag>}
          <FitChip fit={fit} />
        </div>
        {latest && video !== undefined ? (
          <span className="gtitle" data-tip={video.title}>
            {index === 0 ? text.latest : text.videoN(index + 1)}
            {video.title}
            {video.views === null ? "" : ` · ${formatCount(video.views)}`}
            {age === null ? "" : ` · ${age}`}
          </span>
        ) : null}
        <span className="gmeta">
          <span>
            <b>{formatCount(item.medianViews)}</b> {text.median}
          </span>
          <span>
            <b>{item.uploads30}</b> {text.in30}
          </span>
          {item.country === null ? null : (
            <span>
              <b>{item.country}</b>
            </span>
          )}
        </span>
        {signals ? (
          <div className="row wrap gsig">
            {isGold(item) ? (
              <Tag tone="good" icon="gem">
                {text.gold}
              </Tag>
            ) : null}
            {sponsors.slice(0, sponsorTags).map((s) => (
              <Tag key={s}>{s}</Tag>
            ))}
            {sponsors.length > sponsorTags ? (
              <Tag>{text.sponsorsMore(sponsors.length - sponsorTags)}</Tag>
            ) : null}
            {item.emailConfirmed ? (
              <Tag tone="good" icon="at">
                {text.confirmed}
              </Tag>
            ) : item.email !== null || item.foundEmails > 0 ? (
              <Tag tone="warn" icon="at">
                {text.emailFound}
              </Tag>
            ) : null}
            {item.emailedBefore === null ? null : (
              <span
                data-tip={text.emailedBeforeTip(
                  item.emailedBefore.who,
                  item.emailedBefore.at === null
                    ? null
                    : (videoAge(item.emailedBefore.at, now) ?? null),
                )}
              >
                <Tag tone="warn" icon="users">
                  {text.emailedBefore}
                </Tag>
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});
