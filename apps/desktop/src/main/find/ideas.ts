import type { ChannelResponse } from "@gratovo/ipc";

/**
 * Gemini's keyword ideas for the Find queue (plan step 5, D15 and D33). One method, so the
 * bridge-backed version and the example stand-in (task B10) can take the stub's place without
 * the handlers changing. Every answer is a value: a bridge that is off is `bridge_off`, not a
 * throw.
 */
export interface FindIdeas {
  /** Asks for `count` ideas (1 to 20); one request at a time. */
  suggest(count: number): Promise<ChannelResponse<"find:ideas">>;
}

/** Ideas with no bridge behind them: always `bridge_off`, and nothing is called. */
export function createStubIdeas(): FindIdeas {
  return {
    suggest: () => Promise.resolve({ ok: false, problem: "bridge_off" }),
  };
}
