import type { Drill, DrillNote } from "@gratovo/core/insights";

import { DEAL_FLOW } from "@gratovo/core";

import { money } from "../../lib/format";
import { strings } from "../../strings";
import { num, pct } from "./format";

const n = strings.insights.drill.names;
const steps = strings.insights.overview.pipeline.short;
const brandSteps = strings.insights.funnel.brandFunnel.steps;

/** The words for a row's note. */
export function noteText(note: DrillNote): string {
  switch (note.kind) {
    case "reason":
      return n.reasons[note.reason];
    case "fit":
      return strings.insights.drill.notes.fit(note.fit);
    case "gone":
      return strings.insights.drill.notes.gone;
    case "money":
      return strings.insights.drill.notes.money(
        money(note.amount),
        note.days === null ? null : strings.insights.overview.fmt.daysLong(num(note.days)),
      );
    case "days":
      return strings.insights.drill.notes.days(
        strings.insights.overview.fmt.daysLong(num(note.days)),
      );
    case "margin":
      return strings.insights.drill.notes.margin(pct(note.margin));
  }
}

/** What a drill sheet is called: what the number counted. */
export function drillTitle(drill: Drill): string {
  switch (drill.kind) {
    case "step":
      return n.step(steps[drill.step]);
    case "stuck":
      return n.stuck(steps[drill.step]);
    case "keyword":
      return n.keyword(drill.keyword);
    case "live":
      return n.live[drill.group];
    case "leaving":
      return n.leaving(drill.day);
    case "mistakes":
      return n.mistakes;
    case "undated":
      return n.undated;
    case "rejected":
      return n.rejected(n.reasons[drill.reason]);
    case "secondLook":
      return n.secondLook(n.reasons[drill.reason]);
    case "fuel":
      return n.fuel;
    case "unconfirmed":
      return n.unconfirmed;
    case "repliesWaiting":
      return n.repliesWaiting;
    case "unreadable":
      return n.unreadable[drill.which];
    case "brandStep":
      return n.brandStep(brandSteps[drill.step]);
    case "brandStuck":
      return n.brandStuck(brandSteps[drill.step]);
    case "lateInvoices":
      return n.lateInvoices;
    case "payoutsDue":
      return n.payoutsDue;
    case "stuckDeals":
      return n.stuckDeals(drill.step === null ? null : (DEAL_FLOW[drill.step]?.name ?? null));
    case "underFloor":
      return n.underFloor;
    case "idleCreators":
      return n.idleCreators;
    case "noNextDeal":
      return n.noNextDeal;
  }
}
