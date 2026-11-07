import type { Creator, OutreachDraft, ThreadSummary } from "../data";
import { isOpenDraft } from "./board";

/**
 * Reach › Replies (plan step 6, D23): every creator who wrote back, newest reply first. Pure, so
 * the list and its counts are the same wherever they show.
 */

/** Where a reply stands for the person. */
export type ReplyState = "writing" | "draft" | "your_move" | "answered" | "bounced" | "closed";

export interface ReplyItem {
  readonly creator: Creator;
  readonly thread: ThreadSummary;
  /** The open answer draft, if there is one. */
  readonly draft: OutreachDraft | null;
  readonly state: ReplyState;
  /** In ms: when their last message came. */
  readonly at: number;
}

/** The creator's open answer draft, the newest when there are several. */
function answerOf(drafts: readonly OutreachDraft[], creator: string): OutreachDraft | null {
  let best: OutreachDraft | null = null;
  for (const d of drafts) {
    if (d.creator === creator && d.kind === "reply" && isOpenDraft(d)) {
      if (best === null || d.createdAt > best.createdAt) {
        best = d;
      }
    }
  }
  return best;
}

function stateOf(creator: Creator, thread: ThreadSummary, draft: OutreachDraft | null): ReplyState {
  // Never contact or rejected: their reply is kept, but nothing waits on the person (review of 6d).
  if (creator.stage === "never" || creator.stage === "rejected") {
    return "closed";
  }
  if (thread.lastIn?.bounce === true) {
    return "bounced";
  }
  if (draft !== null) {
    return draft.state === "drafting" ? "writing" : "draft";
  }
  return thread.answered ? "answered" : "your_move";
}

/** Each creator with a message in, newest first; creators not in `creators` are left out. */
export function replyItems(
  creators: readonly Creator[],
  threads: readonly ThreadSummary[],
  drafts: readonly OutreachDraft[],
): ReplyItem[] {
  const byId = new Map(creators.map((c) => [c.id, c]));
  const items: ReplyItem[] = [];
  for (const thread of threads) {
    const creator = byId.get(thread.creator);
    if (creator === undefined || thread.lastIn === null) {
      continue;
    }
    const draft = answerOf(drafts, creator.id);
    items.push({
      creator,
      thread,
      draft,
      state: stateOf(creator, thread, draft),
      at: thread.lastIn.at,
    });
  }
  return items.sort((a, b) => b.at - a.at || a.creator.name.localeCompare(b.creator.name));
}

/** How many replies wait on the person: a draft to send, or nothing written yet. */
export function repliesToAnswer(items: readonly ReplyItem[]): number {
  return items.filter((i) => i.state === "draft" || i.state === "your_move").length;
}

/** The chips on the Replies queue (X7). */
export const replyFilters = ["all", "needs", "interested", "notnow", "price"] as const;
export type ReplyFilter = (typeof replyFilters)[number];

const interestedTypes: ReadonlySet<string> = new Set([
  "inf.interested_vague",
  "inf.agrees",
  "inf.media_kit",
  "inf.gives_rate",
]);

/** Whether a reply belongs under the chip. */
export function replyMatches(item: ReplyItem, filter: ReplyFilter): boolean {
  const reading = item.thread.lastIn?.reading ?? null;
  const type = reading?.replyType ?? null;
  switch (filter) {
    case "all":
      return true;
    case "needs":
      return item.state === "draft" || item.state === "your_move";
    case "interested":
      return type !== null && interestedTypes.has(type);
    case "notnow":
      return type === "inf.later";
    case "price":
      return type === "inf.gives_rate" || (reading?.facts.some((f) => f.key === "rate") ?? false);
  }
}

/** Whether the search words are in the creator, the reply's first line or Gemini's reading. */
export function replySearch(item: ReplyItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return true;
  }
  const reading = item.thread.lastIn?.reading ?? null;
  const hay = [
    item.creator.name,
    item.creator.handle,
    item.thread.lastIn?.preview ?? "",
    reading?.label ?? "",
    reading?.summary ?? "",
  ];
  return hay.some((s) => s.toLowerCase().includes(q));
}
