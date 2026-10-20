import { describe, expect, it, vi } from "vitest";

import { createTeamKeys, keyLifetimeMs } from "./team-keys";

function setup(answers: unknown[] = ["yt-test-000"]) {
  let clock = 1_000_000;
  const pending: ((value: unknown) => void)[] = [];
  const fetchYoutubeKey = vi.fn(() =>
    answers.length > 0
      ? Promise.resolve(answers.shift())
      : new Promise<unknown>((resolve) => {
          pending.push(resolve);
        }),
  );
  const keys = createTeamKeys({ fetchYoutubeKey, now: () => clock });
  return {
    keys,
    fetchYoutubeKey,
    pending,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createTeamKeys", () => {
  it("asks the server once and keeps the key for an hour", async () => {
    const t = setup(["yt-test-000", "yt-test-001"]);
    expect(await t.keys.youtubeKey()).toBe("yt-test-000");
    t.advance(keyLifetimeMs - 1);
    expect(await t.keys.youtubeKey()).toBe("yt-test-000");
    expect(t.fetchYoutubeKey).toHaveBeenCalledOnce();
    t.advance(1);
    expect(await t.keys.youtubeKey()).toBe("yt-test-001");
    expect(t.fetchYoutubeKey).toHaveBeenCalledTimes(2);
  });

  it("joins one request when two callers ask at once", async () => {
    const t = setup([]);
    const first = t.keys.youtubeKey();
    const second = t.keys.youtubeKey();
    t.pending[0]?.("yt-test-000");
    expect(await Promise.all([first, second])).toEqual(["yt-test-000", "yt-test-000"]);
    expect(t.fetchYoutubeKey).toHaveBeenCalledOnce();
  });

  it("answers null when the team has no key, and doesn't keep the null", async () => {
    const t = setup([null, "", "yt-test-000"]);
    expect(await t.keys.youtubeKey()).toBeNull();
    expect(await t.keys.youtubeKey()).toBeNull();
    expect(await t.keys.youtubeKey()).toBe("yt-test-000");
  });

  it("forgets the key on clear, and a call in flight then rejects", async () => {
    const t = setup(["yt-test-000"]);
    expect(await t.keys.youtubeKey()).toBe("yt-test-000");
    t.keys.clear();
    const late = t.keys.youtubeKey();
    t.keys.clear();
    t.pending[0]?.("yt-test-001");
    await expect(late).rejects.toThrow("The account changed");
    expect(t.fetchYoutubeKey).toHaveBeenCalledTimes(2);
  });

  it("passes a failure on and tries again next time", async () => {
    const fetchYoutubeKey = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("yt-test-000");
    const keys = createTeamKeys({ fetchYoutubeKey, now: () => 0 });
    await expect(keys.youtubeKey()).rejects.toThrow("offline");
    expect(await keys.youtubeKey()).toBe("yt-test-000");
  });
});
