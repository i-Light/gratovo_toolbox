import { formatCount } from "@gratovo/core/find";
import { Icon, Tag } from "@gratovo/ui";
import { useState } from "react";

import { Thumb } from "../find/thumb";
import { ago, shortDate } from "../lib/format";
import { strings } from "../strings";
import { videoUrl, type CreatorDetail } from "./detail";

const text = strings.creatorRecord;
const numbers = text.numbers;

/** How much of the description shows before "Show all". */
export const descriptionShown = 600;

function Stat({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

/** The numbers, the latest videos, the fit parts, sponsors, addresses found and the description. */
export function CreatorOverview({ item }: { readonly item: CreatorDetail }) {
  const [all, setAll] = useState(false);
  // Read once on mount: the ages do not need to tick.
  const [now] = useState(() => Date.now());
  const description = item.description;
  const long = description.length > descriptionShown;
  const found =
    item.foundAt === null && item.keyword === null
      ? numbers.unknown
      : numbers.foundBy(item.keyword, item.foundAt === null ? null : shortDate(item.foundAt));
  return (
    <>
      {item.hasNumbers ? (
        <div className="stats">
          <Stat
            value={item.subscribers === null ? numbers.hidden : formatCount(item.subscribers)}
            label={numbers.subscribers}
          />
          <Stat value={formatCount(item.medianViews)} label={numbers.median} />
          <Stat value={String(item.uploads30)} label={numbers.uploads} />
          <Stat value={item.country ?? numbers.unknown} label={numbers.country} />
          <Stat
            value={item.latestUploadAt === null ? numbers.unknown : ago(item.latestUploadAt, now)}
            label={numbers.latest}
          />
          <Stat value={found} label={numbers.found} />
        </div>
      ) : (
        <p className="hint">{text.noNumbers}</p>
      )}
      <section className="col tight" aria-label={text.latestVideos}>
        <h4>{text.latestVideos}</h4>
        {item.videos.length === 0 ? (
          <p className="hint">{text.noVideos}</p>
        ) : (
          <div className="cr-vids">
            {item.videos.slice(0, 6).map((v) => {
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
      <div className="cr-tags">
        <span className="small muted">{text.sponsors}</span>
        {item.sponsors.length === 0 ? (
          <span className="small muted">{text.sponsorsNone}</span>
        ) : (
          item.sponsors.map((s, i) => <Tag key={`${s}${String(i)}`}>{s}</Tag>)
        )}
      </div>
      <div className="row small muted">
        <Icon name="mail" />
        <span>{text.addresses(item.foundEmails)}</span>
      </div>
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
    </>
  );
}
