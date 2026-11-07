import { DEAL_FLOW } from "@gratovo/core";
import type { Creator } from "@gratovo/core/data";
import type { TodayItem } from "@gratovo/core/today";
import { Btn } from "@gratovo/ui";

import { AudienceCheck } from "../close/audience-check";
import { ContactBlock } from "../find/contact-block";
import { Triage, useReview } from "../find/triage";
import { peek } from "../lib/actions";
import { money } from "../lib/format";
import { dayWords } from "../lib/reach-actions";
import { useApp } from "../lib/store";
import { asCatalogItem } from "../record/draft-actions";
import { DraftCard } from "../record/draft-card";
import { useCreatorItem } from "../record/use-creator-item";
import { strings } from "../strings";
import { LastMessages } from "./pane-parts";

const text = strings.today.pane;

const Changed = () => (
  <p className="muted" data-ui="today.work.changed">
    {text.changed}
  </p>
);

/** The catalog's own item when it has one, else the creator as the page holds it. */
function Contact({ creator }: { readonly creator: Creator }) {
  const { item } = useCreatorItem(creator.id);
  return <ContactBlock item={item ?? { ...asCatalogItem(creator), emails: [] }} />;
}

function Review() {
  const review = useReview();
  return <Triage review={review} />;
}

/** What the selected item needs, by kind. */
export function PaneBody({ item }: { readonly item: TodayItem }) {
  const data = useApp((s) => s.data);
  const ref = item.ref;
  const creator = ref?.kind === "creator" ? data.creators.find((c) => c.id === ref.id) : undefined;
  const brand = ref?.kind === "brand" ? data.brands.find((b) => b.id === ref.id) : undefined;
  const deal = ref?.kind === "deal" ? data.deals.find((d) => d.id === ref.id) : undefined;
  switch (item.kind) {
    case "finds":
      return <Review />;
    case "reply":
    case "send":
    case "followup":
    case "audience":
    case "contact": {
      if (creator === undefined) {
        return <Changed />;
      }
      if (item.kind === "contact") {
        return <Contact creator={creator} />;
      }
      if (item.kind === "audience") {
        return (
          <div className="col" style={{ gap: "12px" }}>
            <div className="card">
              <AudienceCheck creator={creator} />
            </div>
            <LastMessages creatorId={creator.id} name={creator.name} />
          </div>
        );
      }
      const hasDraft = data.reach.drafts.some((d) => d.id === item.draft);
      return (
        <div className="col" style={{ gap: "12px" }}>
          {item.kind === "reply" ? (
            <LastMessages creatorId={creator.id} name={creator.name} />
          ) : null}
          {hasDraft && item.draft !== null ? (
            <DraftCard draftId={item.draft} />
          ) : item.kind === "reply" ? (
            <div className="card tight row" style={{ gap: "10px" }}>
              <p className="grow muted">
                {data.reach.gemini === "ready" ? text.replyWriting : text.replyYourMove}
              </p>
              <Btn
                size="sm"
                dataUi="today.work.emails"
                onClick={() => {
                  peek({ kind: "creator", id: creator.id }, undefined, { tab: "emails" });
                }}
              >
                {text.openEmails}
              </Btn>
            </div>
          ) : (
            <Changed />
          )}
        </div>
      );
    }
    default: {
      if (ref === null || (deal === undefined && brand === undefined)) {
        return <Changed />;
      }
      const rows: (readonly [string, string])[] = [];
      if (deal !== undefined) {
        const step = DEAL_FLOW[deal.step];
        const open = deal.checks.indexOf(false);
        rows.push(
          [text.step, step?.name ?? ""],
          [text.nextStep, open >= 0 ? (step?.items[open] ?? "") : text.stepReady],
          [text.brand, data.brands.find((b) => b.id === deal.brand)?.name ?? ""],
          [text.creator, data.creators.find((c) => c.id === deal.creator)?.name ?? ""],
        );
        if (data.seesMoney && deal.price !== null) {
          rows.push([text.price, money(deal.price)]);
        }
      } else if (brand !== undefined) {
        rows.push([text.brand, brand.name], [text.sells, brand.sells]);
      }
      if (item.due !== null) {
        rows.push([text.due, dayWords(item.due)]);
      }
      return (
        <div className="card col" style={{ gap: "10px" }} data-ui="today.work.next">
          <dl className="tdy-facts">
            {rows
              .filter(([, v]) => v !== "")
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="muted small">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          <div className="row">
            <Btn
              kind="pri"
              dataUi="today.work.open"
              onClick={() => {
                peek({ kind: ref.kind, id: ref.id });
              }}
            >
              {deal === undefined ? text.openBrand : text.openDeal}
            </Btn>
          </div>
        </div>
      );
    }
  }
}
