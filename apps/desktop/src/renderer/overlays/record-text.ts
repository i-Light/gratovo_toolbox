import { DEAL_FLOW } from "@gratovo/core";

import { money } from "../lib/format";
import type { Brand, Creator, Deal } from "../lib/store";
import { strings } from "../strings";

/** A brand's status in words ("negotiating" reads "Negotiating"); an unknown status is shown as it is. */
function statusWord(status: string): string {
  return Object.hasOwn(strings.record.brandStatus, status)
    ? strings.record.brandStatus[status as keyof typeof strings.record.brandStatus]
    : status;
}

/** The line under a creator's name: "@handle · stage · email" (no email: just the first two). */
export function creatorSub(creator: Creator): string {
  const parts = [creator.handle, strings.record.stages[creator.stage]];
  if (creator.email !== null) {
    parts.push(creator.email);
  }
  return parts.join(" · ");
}

/** The line under a brand's name: "what it sells · status". */
export function brandSub(brand: Brand): string {
  return `${brand.sells} · ${statusWord(brand.status)}`;
}

/** The line under a deal's name: "step name · money", or just the step when the price is hidden. */
export function dealSub(deal: Deal): string {
  const step = DEAL_FLOW[deal.step]?.name ?? strings.record.unknownName;
  return deal.price === null ? step : `${step} · ${money(deal.price)}`;
}
