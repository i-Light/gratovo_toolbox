import { creatorStepIndex, creatorSteps } from "@gratovo/core/data";
import { Btn, Icon, Tag } from "@gratovo/ui";
import type { ReactNode } from "react";

import { FitChip } from "../find/fit-chip";
import { ThumbAvatar } from "../find/thumb";
import { isPartShown } from "../lib/wired";
import { useApp } from "../lib/store";
import { strings } from "../strings";
import { CreatorEmails } from "./creator-emails";
import { CreatorNext } from "./creator-next";
import { CreatorNotes } from "./creator-notes";
import { CreatorOverview } from "./creator-blocks";
import { SponsorsSection, VideosSection } from "./creator-overview";
import { channelUrl } from "./detail";
import { CreatorAudience } from "./creator-audience";
import { ChannelTab, ContactsTab, DealsTab } from "./creator-tabs";
import { RecordActivity } from "./record-activity";
import { RecordShell, type RecordTab } from "./record-shell";
import { Steps } from "./steps";
import { useCreatorItem } from "./use-creator-item";

const text = strings.creatorRecord;

/** The star rating as five stars, filled up to the rating. */
function Stars({ n }: { readonly n: number }) {
  return (
    <span className="cr-stars" role="img" aria-label={text.header.stars(n)} data-ui="record.stars">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= n ? "on" : undefined}>
          <Icon name="star" size={14} />
        </span>
      ))}
    </span>
  );
}

/** The header and the tab strip as grey shapes, for the moment before the channel arrives. */
function Skeleton() {
  return (
    <div className="cr-skel" role="status" aria-label={text.loading} aria-busy="true">
      <div className="head">
        <i></i>
        <span>
          <i style={{ width: "55%" }}></i>
          <i style={{ width: "35%" }}></i>
        </span>
      </div>
      <div className="tabsk">
        <i></i>
        <i></i>
        <i></i>
      </div>
    </div>
  );
}

/**
 * One body for the peek and the record page (D23): header, the one next step, then the tabs
 * Overview, Notes and Activity. `fallback` shows instead of "not in your data" when main's
 * catalog lacks the channel but the page still holds it.
 */
export function CreatorRecord({
  id,
  layout,
  tab: wanted,
  fallback,
}: {
  readonly id: string;
  readonly layout: "peek" | "page";
  /** The tab to open on; Overview when it is not one of the tabs. */
  readonly tab?: string;
  readonly fallback?: ReactNode;
}) {
  const { status, item, retry } = useCreatorItem(id);
  const source = useApp((s) => s.data.source);
  const details = useApp((s) => s.data.creators.find((c) => c.id === id)?.details);
  const dealCount = useApp((s) => s.data.deals.filter((d) => d.creator === id).length);
  if (status === "loading") {
    return <Skeleton />;
  }
  if (status === "failed") {
    return (
      <div className="col">
        <p className="hint">{text.loadFailed}</p>
        <div className="row">
          <Btn size="sm" onClick={retry}>
            {text.retry}
          </Btn>
        </div>
      </div>
    );
  }
  if (item === null) {
    return fallback !== undefined ? <>{fallback}</> : <p className="hint">{text.notFound}</p>;
  }
  const link = channelUrl(item.id);
  const step = creatorStepIndex(item.stage);
  const relationship = item.stage === "signed" ? (details?.relationship ?? null) : null;
  const tabs: readonly RecordTab[] = [
    { key: "overview", label: text.tabs.overview, render: () => <CreatorOverview item={item} /> },
    { key: "channel", label: text.tabs.channel, render: () => <ChannelTab item={item} /> },
    {
      key: "videos",
      label: text.tabs.videos,
      render: () => <VideosSection item={item} />,
    },
    {
      key: "sponsors",
      label: text.tabs.sponsors,
      render: () => <SponsorsSection item={item} />,
    },
    { key: "contacts", label: text.tabs.contacts, render: () => <ContactsTab item={item} /> },
    {
      key: "audience",
      label: text.tabs.audience,
      render: () => <CreatorAudience creatorId={item.id} />,
    },
    {
      key: "emails",
      label: text.tabs.emails,
      render: () => <CreatorEmails creatorId={item.id} />,
    },
    ...(isPartShown("record.deals", source)
      ? [
          {
            key: "deals",
            label: text.tabs.deals,
            count: dealCount,
            render: () => (
              <DealsTab
                by="creator"
                id={item.id}
                signed={item.stage === "signed"}
                layout={layout}
              />
            ),
          },
        ]
      : []),
    // Kept mounted, so leaving the tab with unsaved text still saves it on blur.
    {
      key: "notes",
      label: text.tabs.notes,
      keepMounted: true,
      render: () => <CreatorNotes item={item} />,
    },
    {
      key: "activity",
      label: text.tabs.activity,
      render: () => <RecordActivity refId={item.id} />,
    },
  ];
  return (
    <RecordShell
      dataUi="record.creator"
      layout={layout}
      face={<ThumbAvatar pic={item.pic} name={item.name} alt={text.avatarAlt(item.name)} />}
      name={item.name}
      nameExtra={item.stars === null ? undefined : <Stars n={item.stars} />}
      sub={
        <>
          <span className="muted small handle">{item.handle}</span>
          {link === null ? null : (
            <a className="cr-link" href={link} target="_blank" rel="noreferrer">
              {text.openOnYouTube}
            </a>
          )}
        </>
      }
      tags={
        <>
          <Tag>{strings.record.stages[item.stage]}</Tag>
          {relationship === null ? null : (
            <Tag tone="info">{text.header.relationship[relationship]}</Tag>
          )}
          {item.format === null ? null : <Tag tone="line">{text.header.formats[item.format]}</Tag>}
          {item.botRisk === null ? null : (
            <Tag
              tone={
                item.botRisk.level === "clean"
                  ? "good"
                  : item.botRisk.level === "watch"
                    ? "warn"
                    : "crit"
              }
            >
              {text.header.botRisk[item.botRisk.level]}
            </Tag>
          )}
          <FitChip fit={item.fit} />
        </>
      }
      steps={
        step === null ? undefined : (
          <Steps
            label={text.stepsLabel}
            steps={creatorSteps.map((k) => text.steps[k])}
            at={step}
            hue={item.stage === "signed" ? "var(--close)" : "var(--reach)"}
          />
        )
      }
      next={<CreatorNext item={item} />}
      tabsLabel={text.tabsLabel}
      tabs={tabs}
      {...(wanted === undefined ? {} : { tab: wanted })}
    />
  );
}
