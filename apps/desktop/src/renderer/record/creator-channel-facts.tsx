import { formatCount } from "@gratovo/core/find";

import { monthYear } from "../lib/format";
import { languageName } from "../lib/language";
import { strings } from "../strings";
import type { CreatorDetail } from "./detail";
import { Stat } from "./creator-overview";

const text = strings.creatorRecord.facts;

/** "audio 11/12" as "audio, 11 of 12 videos"; a basis it can't read is shown as the pipeline wrote it. */
export function basisWords(basis: string): string {
  const match = /^(audio|default)\s+(\d{1,6})\/(\d{1,6})$/.exec(basis.trim());
  if (match !== null) {
    const n = Number(match[2]);
    const of = Number(match[3]);
    return match[1] === "audio" ? text.basisAudio(n, of) : text.basisDefault(n, of);
  }
  return basis.trim() === "channel" ? text.basisChannel : basis.trim();
}

/** Seconds as m:ss, or h:mm:ss from an hour. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${String(h)}:${String(m).padStart(2, "0")}:${s}` : `${String(m)}:${s}`;
}

/** A ratio as a whole or one-decimal percent: 0.0412 is "4.1%", 0.5 is "50%". */
export function percent(ratio: number): string {
  const value = ratio * 100;
  if (value > 0 && value < 1) {
    // Enough decimals that a small share never reads 0: 0.04%, 0.004%.
    const digits = Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(value))));
    return text.percent(String(Number(value.toFixed(digits))));
  }
  return text.percent(String(Math.round(value * 10) / 10));
}

/** The channel's language, topics and video facts, each "Not known" when the pipeline has none. */
export function ChannelFactsSection({ item }: { readonly item: CreatorDetail }) {
  const f = item.channelFacts;
  const unknown = text.notKnown;
  const language =
    f.language === null
      ? unknown
      : f.languageBasis === null || f.languageBasis === ""
        ? languageName(f.language)
        : text.languageWith(languageName(f.language), basisWords(f.languageBasis));
  const num = (n: number | null): string => (n === null ? unknown : formatCount(n));
  return (
    <section className="col tight" aria-label={text.title} data-ui="record.channel.facts">
      <h4>{text.title}</h4>
      <div className="stats">
        <Stat value={language} label={text.language} muted={f.language === null} />
        <Stat value={num(f.totalViews)} label={text.totalViews} muted={f.totalViews === null} />
        <Stat value={num(f.videoCount)} label={text.videoCount} muted={f.videoCount === null} />
        <Stat
          value={f.startedAt === null ? unknown : monthYear(f.startedAt)}
          label={text.started}
          muted={f.startedAt === null}
        />
        <Stat value={num(f.medianLikes)} label={text.medianLikes} muted={f.medianLikes === null} />
        <Stat
          value={num(f.medianComments)}
          label={text.medianComments}
          muted={f.medianComments === null}
        />
        <Stat
          value={f.engagementRate === null ? unknown : percent(f.engagementRate)}
          label={text.engagement}
          muted={f.engagementRate === null}
        />
        <Stat
          value={f.medianDurationS === null ? unknown : clock(f.medianDurationS)}
          label={text.duration}
          muted={f.medianDurationS === null}
        />
        <Stat
          value={f.shortsShare === null ? unknown : percent(f.shortsShare)}
          label={text.shorts}
          muted={f.shortsShare === null}
        />
        <Stat
          value={f.paidShare === null ? unknown : percent(f.paidShare)}
          label={text.paid}
          muted={f.paidShare === null}
        />
      </div>
      <div className="row wrap" data-ui="record.channel.topics">
        <small className="muted">{text.topics}</small>
        {f.topics.length === 0 ? (
          <span className="muted">{unknown}</span>
        ) : (
          f.topics.map((topic) => (
            <span key={topic.name} className="chip">
              {text.topicCount(topic.name, topic.count)}
            </span>
          ))
        )}
      </div>
    </section>
  );
}
