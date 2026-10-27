import type { Comment } from "@gratovo/ipc";

import { strings } from "../strings";
import { placeWords } from "./place";

const text = strings.prototype;

type RefName = (ref: { readonly kind: string; readonly id: string }) => string | null;

/**
 * The open comments as text for Claude: a heading, then each comment numbered by its place in the
 * whole list, with its kind, where it was left, what it was pinned to and what it says.
 */
export function commentsForClaude(
  list: readonly Comment[],
  options: { readonly now?: number; readonly refName?: RefName } = {},
): string {
  const when = new Date(options.now ?? Date.now());
  const stamp = `${when.toLocaleDateString("en-GB")} ${when.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  const refName = options.refName ?? (() => null);
  const open = list.filter((c) => c.status !== "done");
  const lines = [text.forClaude.head(open.length, stamp), ""];
  for (const c of open) {
    const number = list.indexOf(c) + 1;
    const scenario =
      c.scenario === "normal" ? "" : text.forClaude.scenario(text.scenarios[c.scenario].name);
    lines.push(
      `${String(number)}. [${text.forClaude.kinds[c.kind]}] ${placeWords(c, refName, text.forClaude.everywhere)} · ${c.anchor.label}${scenario}`,
    );
    lines.push(`   ${c.text.replace(/\n/g, "\n   ")}`);
  }
  return lines.join("\n");
}
