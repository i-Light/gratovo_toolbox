import { ideasCountMax, type ChannelResponse } from "@gratovo/ipc";

import type { GeminiParams } from "../pipeline/gemini-protocol";
import type { GeminiCall } from "../pipeline/gemini-service";

/**
 * Gemini's keyword ideas for the Find queue (plan step 5, D15 and D33). Every answer is a value: a
 * bridge that is off is `bridge_off`, not a throw.
 *
 * Live, it asks the bridge's `action.generate_keywords` once per click, in one fresh chat. It
 * never starts the bridge (ADR 0016 D7: only the owner does, from Settings › Connections), so a
 * bridge that isn't listening with the add-on connected is `bridge_off`. One request is out at a
 * time, and live sends keep the owner's 60 s apart; either way the next click is `busy`.
 *
 * The example data never calls Gemini: a stand-in answers fixed AI keywords after 0.9 s.
 */
export interface FindIdeas {
  /** Asks for `count` ideas (1 to 20); one request at a time. */
  suggest(count: number): Promise<ChannelResponse<"find:ideas">>;
}

type Answer = ChannelResponse<"find:ideas">;

/** One queue entry, as the Find service has it. */
export interface IdeasQueueEntry {
  readonly keyword: string;
  readonly found: number;
  readonly kept: number;
}

export interface IdeasDeps {
  /** The open data: the example data, live data, or null when none is open. */
  mode(): "example" | "live" | null;
  /** The Find queue now. */
  queue(): readonly IdeasQueueEntry[];
  /** Whether the bridge is listening with the add-on connected. It must not start it. */
  bridgeReady(): Promise<boolean>;
  /** The bridge's `action.generate_keywords`. */
  generate(
    params: GeminiParams<"action.generate_keywords">,
  ): Promise<GeminiCall<"action.generate_keywords">>;
  /** Waits `ms`; a timer unless a test names another. */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** The agency's niche: the topic on its own, and the start of every topic. */
export const ideasNiche = "AI tools and AI news on YouTube";
/** How long the example stand-in takes, so the page's waiting state shows. */
export const standInMs = 900;
/** How many ideas the stand-in gives. */
const standInCount = 8;
/** The owner's least time between two Gemini sends. */
export const sendGapMs = 60_000;
/** The best keywords the topic names, and the fewest channels a keyword must have found. */
const topicKeywords = 5;
const topicMinFound = 3;
const topicMax = 500;
const ideaMax = 200;
const droppedMax = 1000;

/** The stand-in's ideas, in order: AI tools and AI news only (never AI music). */
export const standInIdeas: readonly string[] = [
  "claude code tutorial for beginners",
  "cursor ai vs github copilot",
  "ai agents for small business",
  "best ai video generator 2026",
  "run a local llm on windows",
  "chatgpt prompts for productivity",
  "ai news this week",
  "n8n ai automation workflow",
  "notebooklm for research",
  "perplexity ai review",
  "ai coding assistant comparison",
  "gemini 3 vs gpt 5",
];

const key = (keyword: string): string => keyword.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The topic: the niche, and the five keywords that kept the largest share of what they found
 * (those that found at least 3), as far as they fit in the bridge's 500 characters.
 */
export function ideasTopic(queue: readonly IdeasQueueEntry[]): string {
  const best = queue
    .filter((entry) => entry.found >= topicMinFound)
    .map((entry, index) => ({ entry, index, ratio: entry.kept / entry.found }))
    .sort((a, b) => b.ratio - a.ratio || b.entry.found - a.entry.found || a.index - b.index)
    .slice(0, topicKeywords)
    .map(({ entry }) => entry.keyword.trim());
  let topic = ideasNiche;
  let added = 0;
  for (const keyword of best) {
    const longer = `${topic}${added === 0 ? ", like these searches that worked: " : "; "}${keyword}`;
    if (longer.length > topicMax) {
      break;
    }
    topic = longer;
    added += 1;
  }
  return topic;
}

/** The answer's keywords: trimmed, each once, none already queued, at most `count`. */
function cleanIdeas(
  raw: readonly string[],
  queued: ReadonlySet<string>,
  count: number,
): { keywords: string[]; repeats: number } {
  const seen = new Set(queued);
  const keywords: string[] = [];
  let repeats = 0;
  for (const idea of raw) {
    const keyword = idea.trim();
    if (keyword === "" || keyword.length > ideaMax) {
      continue;
    }
    if (seen.has(key(keyword))) {
      repeats += 1;
      continue;
    }
    seen.add(key(keyword));
    if (keywords.length < count) {
      keywords.push(keyword);
    }
  }
  return { keywords, repeats };
}

const timer = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export function createIdeas(deps: IdeasDeps): FindIdeas {
  const wait = deps.wait ?? timer;
  const now = deps.now ?? Date.now;
  let asking = false;
  let lastSend = Number.NEGATIVE_INFINITY;

  async function standIn(count: number, queued: ReadonlySet<string>): Promise<Answer> {
    await wait(standInMs);
    const { keywords, repeats } = cleanIdeas(standInIdeas, queued, Math.min(count, standInCount));
    return { ok: true, keywords, dropped: repeats };
  }

  async function live(count: number, entries: readonly IdeasQueueEntry[]): Promise<Answer> {
    let ready: boolean;
    try {
      ready = await deps.bridgeReady();
    } catch {
      ready = false;
    }
    if (!ready) {
      return { ok: false, problem: "bridge_off" };
    }
    if (now() - lastSend < sendGapMs) {
      return { ok: false, problem: "busy" };
    }
    lastSend = now();
    const answer = await deps.generate({
      topic: ideasTopic(entries),
      count,
      // The queue's keywords as the bridge's "already searched, don't repeat" list. Its
      // `exclusions` would forbid those topics outright, the very ones the topic is built from.
      avoid: entries.map((entry) => entry.keyword),
      chats: 1,
      // One prompt per fresh chat (the owner's rule).
      newChat: true,
    });
    if (!answer.ok) {
      // The code only: the bridge's message can quote the prompt.
      console.error(`Find: keyword ideas failed (${answer.error.code}).`);
      return { ok: false, problem: "failed" };
    }
    const queued = new Set(entries.map((entry) => key(entry.keyword)));
    const { keywords, repeats } = cleanIdeas(answer.result.keywords, queued, count);
    return {
      ok: true,
      keywords,
      dropped: Math.min(answer.result.dropped + repeats, droppedMax),
    };
  }

  return {
    async suggest(count) {
      const wanted = Math.max(1, Math.min(ideasCountMax, Math.floor(count)));
      if (asking) {
        return { ok: false, problem: "busy" };
      }
      const mode = deps.mode();
      if (mode === null) {
        return { ok: false, problem: "failed" };
      }
      asking = true;
      try {
        const entries = deps.queue();
        return mode === "example"
          ? await standIn(wanted, new Set(entries.map((entry) => key(entry.keyword))))
          : await live(wanted, entries);
      } catch {
        console.error("Find: keyword ideas failed.");
        return { ok: false, problem: "failed" };
      } finally {
        asking = false;
      }
    },
  };
}

/** Ideas with no bridge behind them: always `bridge_off`, and nothing is called. For tests. */
export function createStubIdeas(): FindIdeas {
  return {
    suggest: () => Promise.resolve({ ok: false, problem: "bridge_off" }),
  };
}
