import { formatCount, uploadsUnread } from "@gratovo/core/find";
import { Tag } from "@gratovo/ui";
import { useState } from "react";

import { Thumb } from "../find/thumb";
import { ago, shortDate, unreadWords } from "../lib/format";
import { strings } from "../strings";
import { videoUrl, type CreatorDetail } from "./detail";

const text = strings.creatorRecord;
const numbers = text.numbers;

/** How much of the description shows before "Show all". */
export const descriptionShown = 600;

export function Stat({
  value,
  label,
  muted = false,
}: {
  readonly value: string;
  readonly label: string;
  readonly muted?: boolean;
}) {
  return (
    <div className="stat">
      <b className={muted ? "muted" : undefined}>{value}</b>
      <small>{label}</small>
    </div>
  );
}

/** The numbers: subscribers, median views, uploads, country, latest upload and how it was found. */
export function NumbersSection({ item }: { readonly item: CreatorDetail }) {
  const [now] = useState(() => Date.now());
  const unread = uploadsUnread(item);
  const found =
    item.foundAt === null && item.keyword === null
      ? numbers.unknown
      : numbers.foundBy(item.keyword, item.foundAt === null ? null : shortDate(item.foundAt));
  return (
    <>
      {item.hasNumbers ? (
        <div className="stats" data-ui="record.overview.stats">
          <Stat
            value={item.subscribers === null ? numbers.hidden : formatCount(item.subscribers)}
            label={numbers.subscribers}
          />
          <Stat
            value={
              unread
                ? unreadWords(
                    item.medianViews > 0 ? formatCount(item.medianViews) : null,
                    item.readFailed,
                  )
                : formatCount(item.medianViews)
            }
            label={numbers.median}
            muted={unread}
          />
          <Stat
            value={
              unread
                ? unreadWords(item.uploads30 > 0 ? String(item.uploads30) : null, item.readFailed)
                : String(item.uploads30)
            }
            label={numbers.uploads}
            muted={unread}
          />
          <Stat value={item.country ?? numbers.unknown} label={numbers.country} />
          <Stat
            value={
              unread
                ? unreadWords(
                    item.latestUploadAt === null ? null : ago(item.latestUploadAt, now),
                    item.readFailed,
                  )
                : item.latestUploadAt === null
                  ? numbers.unknown
                  : ago(item.latestUploadAt, now)
            }
            label={numbers.latest}
            muted={unread}
          />
          <Stat value={found} label={numbers.found} />
        </div>
      ) : (
        <p className="hint">{text.noNumbers}</p>
      )}
    </>
  );
}

/** The latest videos; `limit` cuts the list (the Overview shows six, the Videos tab all). */
export function VideosSection({
  item,
  limit,
}: {
  readonly item: CreatorDetail;
  readonly limit?: number;
}) {
  const [now] = useState(() => Date.now());
  const shown = limit === undefined ? item.videos : item.videos.slice(0, limit);
  return (
    <section className="col tight" aria-label={text.latestVideos}>
      <h4>{text.latestVideos}</h4>
      {item.videos.length === 0 ? (
        <p className="hint">{text.noVideos}</p>
      ) : (
        <div className="cr-vids">
          {shown.map((v) => {
            const url = videoUrl(v.id);
            const body = (
              <>
                <Thumb pic={v.pic} alt={v.title} name={item.name} />
                <b>{v.title}</b>
                <small>
                  {text.videoMeta(
                    v.views === null
                      ? text.videoViewsHidden
                      : text.videoViews(formatCount(v.views)),
                    v.publishedAt === null ? numbers.unknown : ago(v.publishedAt, now),
                  )}
                </small>
              </>
            );
            return url === null ? (
              <div key={v.id} className="vid">
                {body}
              </div>
            ) : (
              <a
                key={v.id}
                className="vid cr-vid"
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label={text.openVideo(v.title)}
              >
                {body}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The fit score and its parts. */
export function FitSection({ item }: { readonly item: CreatorDetail }) {
  return (
    <section className="col tight">
      <h4>{text.fitHeading(item.fit.score)}</h4>
      <ul className="cr-fit">
        {item.fit.parts.map((p) => (
          <li key={p.key}>
            <span>{strings.findTriage.fitParts[p.key]}</span>
            <span className="n">{text.fitLine(p.points, p.of)}</span>
            <span className="note">{p.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The sponsors seen on the channel. */
export function SponsorsSection({ item }: { readonly item: CreatorDetail }) {
  return (
    <div className="cr-tags">
      <span className="small muted">{text.sponsors}</span>
      {item.sponsors.length === 0 ? (
        <span className="small muted">{text.sponsorsNone}</span>
      ) : (
        item.sponsors.map((s, i) => <Tag key={`${s}${String(i)}`}>{s}</Tag>)
      )}
    </div>
  );
}

/** The channel description, cut at `descriptionShown` characters with Show all. */
export function DescriptionSection({ item }: { readonly item: CreatorDetail }) {
  const [all, setAll] = useState(false);
  const description = item.description;
  const long = description.length > descriptionShown;
  return (
    <section className="col tight">
      <h4>{text.description}</h4>
      {description === "" ? (
        <p className="hint">{text.descriptionNone}</p>
      ) : (
        <>
          <p className="cr-desc">
            {all || !long ? description : description.slice(0, descriptionShown)}
          </p>
          {long ? (
            <button
              type="button"
              className="btn ghost sm"
              aria-expanded={all}
              onClick={() => {
                setAll(!all);
              }}
            >
              {all ? text.showLess : text.showAll}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
