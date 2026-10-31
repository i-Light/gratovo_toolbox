import { DEAL_FLOW } from "@gratovo/core";
import type { Deal } from "@gratovo/core/data";
import { Icon, Tag } from "@gratovo/ui";
import type { ReactNode } from "react";

import { money, shortDate } from "../lib/format";
import { adoptServerData } from "../lib/persist";
import { dealName, useApp } from "../lib/store";
import { isPartShown } from "../lib/wired";
import { strings } from "../strings";
import { RecordTile } from "./brand-record";
import { NotesBox } from "./creator-notes";
import { openFrom } from "./open-record";
import { RecordActivity } from "./record-activity";
import { RecordShell, type RecordTab } from "./record-shell";
import { Steps } from "./steps";

const text = strings.dealRecord;

/** Whether item `i` of step `step` is ticked: all of the steps before the current one, none after. */
function ticked(deal: Deal, step: number, i: number): boolean {
  return step < deal.step || (step === deal.step && deal.checks[i] === true);
}

/** The ten steps, each with its checklist ticked or not. Read only: ticking comes with Deliver. */
function FlowList({ deal }: { readonly deal: Deal }) {
  return (
    <ol className="cr-flow" aria-label={text.stepsHeading} data-ui="record.deal.flow">
      {DEAL_FLOW.map((step, n) => {
        const state = n < deal.step ? "done" : n === deal.step ? "now" : "later";
        return (
          <li
            key={step.key}
            className={state}
            {...(state === "now" ? { "aria-current": "step" as const } : {})}
          >
            <span className="mark">
              {state === "done" ? <Icon name="check" size={12} /> : null}
            </span>
            <b className={state === "later" ? "later" : undefined}>{step.name}</b>
            <span className="small muted">{text.stepState[state]}</span>
            <ul className="cr-checks" aria-label={text.checklist(step.name)}>
              {step.items.map((item, i) => {
                const done = ticked(deal, n, i);
                return (
                  <li key={item} className={done ? "done" : "open"}>
                    {done ? (
                      <Icon name="check" size={12} />
                    ) : (
                      <span className="ic" style={{ width: 12 }} />
                    )}
                    <span>{item}</span>
                    <span className="sr">{done ? text.itemDone : text.itemOpen}</span>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ol>
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

const dateOr = (at: number | null): string => (at === null ? text.notSet : shortDate(at));

/** The price, the payout, our margin and where the invoice stands. Only a viewer who sees money gets it. */
function MoneyCard({ deal }: { readonly deal: Deal }) {
  const m = text.money;
  const margin =
    deal.price !== null && deal.payout !== null && deal.price > 0
      ? m.marginValue(
          money(deal.price - deal.payout),
          Math.round(((deal.price - deal.payout) / deal.price) * 100),
        )
      : null;
  const when = (at: number | null): string => (at === null ? m.notYet : shortDate(at));
  return (
    <section className="card flat tight" data-ui="record.deal.money" aria-label={text.moneyHeading}>
      <h4>{text.moneyHeading}</h4>
      <dl className="kv">
        <Row label={m.price}>{deal.price === null ? text.notSet : money(deal.price)}</Row>
        <Row label={m.payout}>{deal.payout === null ? text.notSet : money(deal.payout)}</Row>
        <Row label={m.margin}>{margin ?? text.notSet}</Row>
        <Row label={m.invoiceSent}>{when(deal.invoice.sentAt)}</Row>
        <Row label={m.invoiceDue}>{when(deal.invoice.dueAt)}</Row>
        <Row label={m.invoicePaid}>{when(deal.invoice.paidAt)}</Row>
        <Row label={m.creatorPaid}>{when(deal.paidCreatorAt)}</Row>
      </dl>
    </section>
  );
}

function DealSteps({ deal, layout }: { readonly deal: Deal; readonly layout: "peek" | "page" }) {
  const seesMoney = useApp((s) => s.data.seesMoney);
  const source = useApp((s) => s.data.source);
  const brand = useApp((s) => s.data.brands.find((b) => b.id === deal.brand));
  const creator = useApp((s) => s.data.creators.find((c) => c.id === deal.creator));
  const owner = useApp((s) => s.data.team.find((m) => m.id === deal.owner));
  const l = text.labels;
  return (
    <>
      <FlowList deal={deal} />
      {seesMoney ? <MoneyCard deal={deal} /> : null}
      <section className="cr-block">
        <h4>{text.detailsHeading}</h4>
        <dl className="kv" data-ui="record.deal.facts">
          <Row label={l.deliverable}>{deal.deliverable ?? text.notSet}</Row>
          <Row label={l.placement}>{deal.placement ?? text.notSet}</Row>
          <Row label={l.model}>{deal.model === null ? text.notSet : text.models[deal.model]}</Row>
          <Row label={l.terms}>{deal.terms ?? text.notSet}</Row>
          <Row label={l.draftDue}>{dateOr(deal.creatorDeadline)}</Row>
          <Row label={l.goLive}>{dateOr(deal.goLiveAt)}</Row>
          <Row label={l.stepDue}>{dateOr(deal.dueAt)}</Row>
          {deal.liveUrl === null ? null : <Row label={l.video}>{deal.liveUrl}</Row>}
          <Row label={l.brand}>
            {brand === undefined ? (
              strings.record.unknownName
            ) : isPartShown("record.deals", source) ? (
              <button
                type="button"
                className="cr-link-btn"
                data-ui="record.brand-link"
                aria-label={text.openBrand(brand.name)}
                onClick={() => {
                  openFrom(layout, { kind: "brand", id: brand.id });
                }}
              >
                {brand.name}
              </button>
            ) : (
              brand.name
            )}
          </Row>
          <Row label={l.creator}>
            {creator === undefined ? (
              strings.record.unknownName
            ) : (
              <button
                type="button"
                className="cr-link-btn"
                data-ui="record.creator-link"
                aria-label={text.openCreator(creator.name)}
                onClick={() => {
                  openFrom(layout, { kind: "creator", id: creator.id });
                }}
              >
                {creator.name}
              </button>
            )}
          </Row>
          {owner === undefined ? null : <Row label={l.owner}>{owner.name}</Row>}
        </dl>
      </section>
    </>
  );
}

/** Writes a deal note straight through `data:write`; true when it was stored. */
function dealWriter(id: string): (notes: string, base: string) => Promise<boolean> {
  return async (notes, base) => {
    try {
      const result = await window.gratovo.invoke("data:write", {
        writes: [{ kind: "deal.notes", id, notes, base }],
      });
      if (result.ok) {
        // Keep the store in step, so a reopened record shows the saved text. Main sends no
        // change for this write, and the persister must not echo it back.
        adoptServerData((draft) => {
          const row = draft.deals.find((x) => x.id === id);
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
 * The deal record frame (R6): header (brand and creator, price and payout for a viewer who sees
 * money, the deliverable, the step), the ten steps and the tabs Steps and money, Notes, Activity.
 * Read only until Deliver (ticking, checks, shipping, the deal room).
 */
export function DealRecord({
  id,
  layout,
  tab,
}: {
  readonly id: string;
  readonly layout: "peek" | "page";
  readonly tab?: string;
}) {
  const deal = useApp((s) => s.data.deals.find((d) => d.id === id));
  const name = useApp((s) => {
    const found = s.data.deals.find((d) => d.id === id);
    return found === undefined ? "" : dealName(s.data, found);
  });
  const seesMoney = useApp((s) => s.data.seesMoney);
  if (deal === undefined) {
    return <p className="hint">{strings.record.notFound}</p>;
  }
  const step = DEAL_FLOW[deal.step]?.name ?? strings.record.unknownName;
  const tabs: readonly RecordTab[] = [
    {
      key: "steps",
      label: seesMoney ? text.tabs.stepsAndMoney : text.tabs.steps,
      render: () => <DealSteps deal={deal} layout={layout} />,
    },
    {
      key: "notes",
      label: text.tabs.notes,
      keepMounted: true,
      render: () => (
        <NotesBox
          notes={deal.notes}
          cut={deal.notesCut}
          label={text.notesLabel}
          hint={text.notesHint}
          write={dealWriter(deal.id)}
        />
      ),
    },
    {
      key: "activity",
      label: text.tabs.activity,
      render: () => <RecordActivity refId={deal.id} empty={text.activityNone} />,
    },
  ];
  const money_ =
    seesMoney && deal.price !== null && deal.payout !== null
      ? text.price(money(deal.price), money(deal.payout))
      : null;
  const sub = [money_, deal.deliverable].filter((x): x is string => x !== null && x !== "");
  return (
    <RecordShell
      dataUi="record.deal"
      layout={layout}
      face={<RecordTile icon="box" />}
      name={name}
      {...(sub.length === 0 ? {} : { sub: <span className="muted small">{sub.join(" · ")}</span> })}
      tags={<Tag>{step}</Tag>}
      steps={
        <Steps
          label={text.stepsLabel}
          steps={DEAL_FLOW.map((s) => s.name)}
          at={deal.step}
          hue="var(--deliver)"
        />
      }
      tabsLabel={text.tabsLabel}
      tabs={tabs}
      {...(tab === undefined ? {} : { tab })}
    />
  );
}
