/**
 * The team's YouTube key (plan G13): fetched from the members-only `team_youtube_key()` function on
 * demand, kept in this process's memory for at most an hour, never written to disk, logged or sent
 * to the page. Sign-out and a session end clear it.
 */

export interface TeamKeys {
  /** The key, or null when the team hasn't set one. Throws when the server can't be asked. */
  youtubeKey(): Promise<string | null>;
  /** Forgets the cached key; a call still in flight rejects instead of answering. */
  clear(): void;
}

export const keyLifetimeMs = 60 * 60 * 1000;

export function createTeamKeys(o: {
  /** Calls `team_youtube_key()`; resolves with what the server returned. */
  fetchYoutubeKey: () => Promise<unknown>;
  now: () => number;
}): TeamKeys {
  let cached: { value: string; until: number } | null = null;
  let inflight: Promise<string | null> | null = null;
  // Bumped by clear(), so an answer that arrives after it is dropped.
  let epoch = 0;

  async function load(started: number): Promise<string | null> {
    try {
      const value = await o.fetchYoutubeKey();
      if (started !== epoch) {
        throw new Error("The account changed while the team key was being fetched.");
      }
      const key = typeof value === "string" && value !== "" ? value : null;
      // Null isn't cached: the owner may add the key at any time.
      if (key !== null) {
        cached = { value: key, until: o.now() + keyLifetimeMs };
      }
      return key;
    } finally {
      if (started === epoch) {
        inflight = null;
      }
    }
  }

  return {
    youtubeKey() {
      if (cached !== null && o.now() < cached.until) {
        return Promise.resolve(cached.value);
      }
      cached = null;
      inflight ??= load(epoch);
      return inflight;
    },

    clear() {
      epoch += 1;
      cached = null;
      inflight = null;
    },
  };
}
