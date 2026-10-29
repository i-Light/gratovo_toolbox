import type { Drill } from "@gratovo/core/insights";

import { strings } from "../../strings";

const n = strings.insights.drill.names;
const steps = strings.insights.overview.pipeline.short;

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
  }
}
