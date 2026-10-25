import type { Creator, OutreachDraft, ThreadSummary } from "../data";
import { isOpenDraft } from "./board";

/**
 * Reach › Replies (plan step 6, D23): every creator who wrote back, newest reply first. Pure, so
 * the list and its counts are the same wherever they show.
 */

/** Where a reply stands for the person. */
export type ReplyState = "writing" | "draft" | "your_move" | "answered" | "bounced";

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

function stateOf(thread: ThreadSummary, draft: OutreachDraft | null): ReplyState {
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
    items.push({ creator, thread, draft, state: stateOf(thread, draft), at: thread.lastIn.at });
  }
  return items.sort((a, b) => b.at - a.at || a.creator.name.localeCompare(b.creator.name));
}

/** How many replies wait on the person: a draft to send, or nothing written yet. */
export function repliesToAnswer(items: readonly ReplyItem[]): number {
  return items.filter((i) => i.state === "draft" || i.state === "your_move").length;
}
