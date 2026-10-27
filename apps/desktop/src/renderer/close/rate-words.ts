import type { CreatorKit } from "@gratovo/core/data";

import { money } from "../lib/format";
import { strings } from "../strings";

/**
 * The rate in words for a kit: the amount, "Hidden" when one is stored but this viewer doesn't see
 * money, or null when there is none.
 */
export function rateWords(kit: CreatorKit | null): string | null {
  if (kit?.rate != null) {
    return money(kit.rate);
  }
  return kit?.rateKnown === true ? strings.close.audience.hidden : null;
}
