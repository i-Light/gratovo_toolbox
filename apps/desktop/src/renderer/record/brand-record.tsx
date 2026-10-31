import { brandContactsMax, brandStatuses, type Brand, type BrandStatus } from "@gratovo/core/data";
import { Icon, Tag } from "@gratovo/ui";
import type { ReactNode } from "react";

import { money, shortDate } from "../lib/format";
import { adoptServerData } from "../lib/persist";
import { useApp } from "../lib/store";
import { isPartShown } from "../lib/wired";
import { strings } from "../strings";
import { NotesBox } from "./creator-notes";
import { DealsTab } from "./creator-tabs";
import { openFrom } from "./open-record";
import { RecordActivity } from "./record-activity";
import { RecordShell, type RecordTab } from "./record-shell";
import { Steps } from "./steps";

const text = strings.brandRecord;
const o = text.overview;

/** The steps a brand moves through; "lost" is not one of them, it shows a tag. */
const brandSteps = brandStatuses.filter((s): s is Exclude<BrandStatus, "lost"> => s !== "lost");

/** A brand status in words. */
export const statusWord = (status: BrandStatus): string => strings.record.brandStatus[status];

/** The square mark that stands in for a brand or a deal in the header. */
export function RecordTile({ icon }: { readonly icon: "flag" | "box" }) {
  return (
    <span className="cr-tile">
      <Icon name={icon} size={22} />
    </span>
  );
}

/** A creator name that opens their record. */
export function CreatorLink({
  id,
  layout,
}: {
  readonly id: string;
  readonly layout: "peek" | "page";
}) {
  const name = useApp((s) => s.data.creators.find((c) => c.id === id)?.name);
  if (name === undefined) {
    return null;
  }
  return (
    <button
      type="button"
      className="cr-link-btn"
      data-ui="record.creator-link"
      onClick={() => {
        openFrom(layout, { kind: "creator", id });
      }}
    >
      {name}
    </button>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function BrandOverview({
  brand,
  layout,
}: {
  readonly brand: Brand;
  readonly layout: "peek" | "page";
}) {
  const seesMoney = useApp((s) => s.data.seesMoney);
  const known = (value: string | null): string => value ?? text.notKnown;
  const pitched = brand.pitched;
  return (
    <>
      <dl className="kv" data-ui="record.brand.facts">
        <Row label={o.size}>
          {brand.headcount === null ? text.notKnown : o.people(brand.headcount)}
        </Row>
        <Row label={o.title}>{known(brand.recommendedTitle)}</Row>
        <Row label={o.paid}>
          {brand.paidSpenderVerified === null
            ? text.notKnown
            : brand.paidSpenderVerified
              ? o.paidYes
              : o.paidNo}
        </Row>
        <Row label={o.hook}>{known(brand.pastCampaignHook)}</Row>
        {seesMoney ? (
          <Row label={o.budget}>
            {brand.budget === null
              ? text.notKnown
              : o.budgetRange(money(brand.budget.low), money(brand.budget.high))}
          </Row>
        ) : null}
        <Row label={o.since}>{brand.since === null ? text.notKnown : shortDate(brand.since)}</Row>
      </dl>
      <section className="cr-block">
        <h4>{o.seen}</h4>
        {brand.seen.length === 0 ? (
          <p className="hint">{o.seenNone}</p>
        ) : (
          <div className="cr-chips">
            {brand.seen.map((id) => (
              <CreatorLink key={id} id={id} layout={layout} />
            ))}
          </div>
        )}
      </section>
      <section className="cr-block">
        <h4>{o.pitch}</h4>
        {pitched === null ? (
          <p className="hint">{o.pitchNone}</p>
        ) : (
          <>
            <p>{o.pitchLine(shortDate(pitched.at), pitched.creators.length, pitched.mode)}</p>
            <div className="cr-chips">
              {pitched.creators.map((id) => (
                <CreatorLink key={id} id={id} layout={layout} />
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function BrandContacts({ brand }: { readonly brand: Brand }) {
  const people = brand.contacts.slice(0, brandContactsMax);
  if (people.length === 0) {
    return <p className="hint">{text.contacts.none}</p>;
  }
  return (
    <ul className="cr-people" aria-label={text.contacts.label}>
      {people.map((p, i) => (
        <li key={`${p.name}${String(i)}`}>
          <b>{p.name}</b>
          <span className="small muted">{p.role ?? text.contacts.noRole}</span>
          <span className="small">{p.email ?? text.contacts.noEmail}</span>
        </li>
      ))}
    </ul>
  );
}

/** Writes a brand note straight through `data:write`; true when it was stored. */
function brandWriter(id: string): (notes: string, base: string) => Promise<boolean> {
  return async (notes, base) => {
    try {
      const result = await window.gratovo.invoke("data:write", {
        writes: [{ kind: "brand.notes", id, notes, base }],
      });
      if (result.ok) {
        // Keep the store in step, so a reopened record shows the saved text. Main sends no
        // change for this write, and the persister must not echo it back.
        adoptServerData((draft) => {
          const row = draft.brands.find((x) => x.id === id);
          if (row !== undefined) {
            row.notes = notes;
            row.notesCut = false;
          }
        });
      }
      return result.ok;
    } catch {
      return false;
    }
  };
}

/**
 * The brand record (R5), for the peek and the record page: header, the brand steps, then the tabs
 * Overview, Contacts, Deals, Notes and Activity. Budget shows only to a viewer who sees money.
 */
export function BrandRecord({
  id,
  layout,
  tab,
}: {
  readonly id: string;
  readonly layout: "peek" | "page";
  readonly tab?: string;
}) {
  const brand = useApp((s) => s.data.brands.find((b) => b.id === id));
  const owner = useApp((s) =>
    s.data.team.find((m) => m.id === s.data.brands.find((b) => b.id === id)?.owner),
  );
  const source = useApp((s) => s.data.source);
  const dealCount = useApp((s) => s.data.deals.filter((d) => d.brand === id).length);
  if (brand === undefined) {
    return <p className="hint">{strings.record.notFound}</p>;
  }
  const at = (brandSteps as readonly BrandStatus[]).indexOf(brand.status);
  const tabs: readonly RecordTab[] = [
    {
      key: "overview",
      label: text.tabs.overview,
      render: () => <BrandOverview brand={brand} layout={layout} />,
    },
    { key: "contacts", label: text.tabs.contacts, render: () => <BrandContacts brand={brand} /> },
    ...(isPartShown("record.deals", source)
      ? [
          {
            key: "deals",
            label: text.tabs.deals,
            count: dealCount,
            render: () => <DealsTab by="brand" id={brand.id} layout={layout} />,
          },
        ]
      : []),
    {
      key: "notes",
      label: text.tabs.notes,
      keepMounted: true,
      render: () => (
        <NotesBox
          notes={brand.notes}
          cut={brand.notesCut}
          label={text.notesLabel}
          hint={text.notesHint}
          write={brandWriter(brand.id)}
        />
      ),
    },
    {
      key: "activity",
      label: text.tabs.activity,
      render: () => <RecordActivity refId={brand.id} empty={text.activityNone} />,
    },
  ];
  return (
    <RecordShell
      dataUi="record.brand"
      layout={layout}
      face={<RecordTile icon="flag" />}
      name={brand.name}
      sub={
        <span className="muted small">
          {[brand.sells, brand.country]
            .filter((x): x is string => x !== null && x !== "")
            .join(" · ")}
        </span>
      }
      tags={
        <>
          <Tag {...(brand.status === "lost" ? { tone: "warn" as const } : {})}>
            {statusWord(brand.status)}
          </Tag>
          {owner === undefined ? null : <Tag tone="line">{text.owner(owner.name)}</Tag>}
        </>
      }
      steps={
        at < 0 ? undefined : (
          <Steps
            label={text.stepsLabel}
            steps={brandSteps.map(statusWord)}
            at={at}
            hue="var(--close)"
          />
        )
      }
      tabsLabel={text.tabsLabel}
      tabs={tabs}
      {...(tab === undefined ? {} : { tab })}
    />
  );
}
