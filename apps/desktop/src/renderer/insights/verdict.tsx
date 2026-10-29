import { Icon } from "@gratovo/ui";
import type { IconName } from "@gratovo/ui";
import type { Difference, Verdict } from "@gratovo/core/insights";

import { strings } from "../strings";

const text = strings.insights;

const verdictIcon: Readonly<Record<Verdict, IconName>> = {
  good: "checkc",
  watch: "eye",
  act: "alert",
  early: "clock",
};

const differenceIcon: Readonly<Record<Difference, IconName>> = {
  clear: "checkc",
  chance: "compare",
  early: "clock",
};

/** The verdict as an icon and a word, for headers and footers. Never colour alone. */
export function VerdictTag({ verdict }: { readonly verdict: Verdict }) {
  return (
    <span className={`ins-verdict ${verdict}`} data-verdict={verdict}>
      <Icon name={verdictIcon[verdict]} size={14} />
      {text.verdict[verdict]}
    </span>
  );
}

/** The verdict as a dot and a word, for table rows. */
export function VerdictDot({ verdict }: { readonly verdict: Verdict }) {
  return (
    <span className={`ins-verdict dot ${verdict}`} data-verdict={verdict}>
      <i aria-hidden="true" />
      {text.verdict[verdict]}
    </span>
  );
}

/** Whether two groups differ: a clear difference, could be chance, or too early. */
export function DifferenceTag({ difference }: { readonly difference: Difference }) {
  return (
    <span className={`ins-verdict diff ${difference}`} data-difference={difference}>
      <Icon name={differenceIcon[difference]} size={14} />
      {text.difference[difference]}
    </span>
  );
}
