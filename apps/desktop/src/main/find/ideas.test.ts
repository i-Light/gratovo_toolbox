import { findIdeasResultSchema } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeminiParams } from "../pipeline/gemini-protocol";
import type { GeminiCall } from "../pipeline/gemini-service";

import {
  createIdeas,
  ideasNiche,
  ideasTopic,
  sendGapMs,
  standInIdeas,
  standInMs,
  type FindIdeas,
  type IdeasQueueEntry,
} from "./ideas";

type Params = GeminiParams<"action.generate_keywords">;
type Call = GeminiCall<"action.generate_keywords">;

const entry = (keyword: string, found = 0, kept = 0): IdeasQueueEntry => ({ keyword, found, kept });

const answered = (keywords: string[], dropped = 0): Call => ({
  ok: true,
  result: { keywords, dropped, raw: keywords.join(", "), model: null },
});

describe("keyword ideas", () => {
  let mode: "example" | "live" | null;
  let queue: IdeasQueueEntry[];
  let ready: () => Promise<boolean>;
  let generate: ReturnType<typeof vi.fn<(params: Params) => Promise<Call>>>;
  let clock: number;
  let ideas: FindIdeas;

  beforeEach(() => {
    vi.useFakeTimers();
    mode = "live";
    queue = [];
    ready = () => Promise.resolve(true);
    generate = vi.fn<(params: Params) => Promise<Call>>(() =>
      Promise.resolve(answered(["ai agents for lawyers"])),
    );
    clock = 10_000_000;
    ideas = createIdeas({
      mode: () => mode,
      queue: () => queue,
      bridgeReady: () => ready(),
      generate,
      now: () => clock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("on the example data", () => {
    beforeEach(() => {
      mode = "example";
    });

    it("answers 8 fixed AI keywords after 0.9 s and never calls the bridge", async () => {
      let answer: unknown = null;
      void ideas.suggest(10).then((value) => {
        answer = value;
      });
      await vi.advanceTimersByTimeAsync(standInMs - 1);
      expect(answer).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toEqual({ ok: true, keywords: standInIdeas.slice(0, 8), dropped: 0 });
      expect(findIdeasResultSchema.safeParse(answer).success).toBe(true);
      expect(generate).not.toHaveBeenCalled();
    });

    it("leaves out the keywords already in the queue", async () => {
      queue = [entry(standInIdeas[0] ?? ""), entry((standInIdeas[3] ?? "").toUpperCase())];
      const pending = ideas.suggest(20);
      await vi.advanceTimersByTimeAsync(standInMs);
      const answer = await pending;
      expect(answer).toEqual({
        ok: true,
        keywords: standInIdeas.filter((_, i) => i !== 0 && i !== 3).slice(0, 8),
        dropped: 2,
      });
    });

    it("gives no more than asked for", async () => {
      const pending = ideas.suggest(3);
      await vi.advanceTimersByTimeAsync(standInMs);
      expect(await pending).toMatchObject({ ok: true, keywords: standInIdeas.slice(0, 3) });
    });
  });

  it("answers bridge_off when the bridge isn't listening with the add-on, and calls nothing", async () => {
    ready = () => Promise.resolve(false);
    expect(await ideas.suggest(5)).toEqual({ ok: false, problem: "bridge_off" });
    ready = () => Promise.reject(new Error("bridge.status failed"));
    expect(await ideas.suggest(5)).toEqual({ ok: false, problem: "bridge_off" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("answers busy while one request is out", async () => {
    let finish: (call: Call) => void = () => undefined;
    generate.mockImplementationOnce(
      () =>
        new Promise<Call>((resolve) => {
          finish = resolve;
        }),
    );
    const first = ideas.suggest(5);
    expect(await ideas.suggest(5)).toEqual({ ok: false, problem: "busy" });
    finish(answered(["ai agents for lawyers"]));
    expect(await first).toMatchObject({ ok: true });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("keeps live sends 60 s apart", async () => {
    await ideas.suggest(5);
    clock += sendGapMs - 1;
    expect(await ideas.suggest(5)).toEqual({ ok: false, problem: "busy" });
    clock += 1;
    expect(await ideas.suggest(5)).toMatchObject({ ok: true });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("asks once, in one fresh chat, with the topic, the count and the queue as already searched", async () => {
    queue = [entry("claude code tips", 10, 8), entry("ai news today", 2, 2)];
    await ideas.suggest(12);
    expect(generate).toHaveBeenCalledWith({
      topic: `${ideasNiche}, like these searches that worked: claude code tips`,
      count: 12,
      avoid: ["claude code tips", "ai news today"],
      chats: 1,
      newChat: true,
    });
  });

  describe("the topic", () => {
    it("is the niche alone when no keyword has found 3 channels", () => {
      expect(ideasTopic([])).toBe(ideasNiche);
      expect(ideasTopic([entry("ai agents", 2, 2)])).toBe(ideasNiche);
    });

    it("names the five keywords that kept the largest share", () => {
      queue = [
        entry("weak one", 10, 1),
        entry("best", 4, 4),
        entry("second", 10, 9),
        entry("third", 10, 8),
        entry("fourth", 20, 14),
        entry("fifth", 10, 6),
        entry("too few", 2, 2),
        entry("sixth", 10, 5),
      ];
      expect(ideasTopic(queue)).toBe(
        `${ideasNiche}, like these searches that worked: best; second; third; fourth; fifth`,
      );
    });

    it("stays within the bridge's 500 characters", () => {
      const long = (c: string) => c.repeat(200);
      const topic = ideasTopic([
        entry(long("a"), 5, 5),
        entry(long("b"), 5, 4),
        entry(long("c"), 5, 3),
      ]);
      expect(topic.length).toBeLessThanOrEqual(500);
      expect(topic).toContain(long("a"));
      expect(topic).not.toContain(long("c"));
    });
  });

  it("maps the answer: trimmed, each once, none already queued, at most count", async () => {
    queue = [entry("AI Agents For Lawyers")];
    generate.mockResolvedValueOnce(
      answered(
        [
          " ai agents for lawyers ",
          "cursor ai tips",
          "Cursor AI tips",
          "",
          "x".repeat(201),
          "ai news recap",
          "ai tools for teachers",
        ],
        4,
      ),
    );
    const answer = await ideas.suggest(2);
    expect(answer).toEqual({ ok: true, keywords: ["cursor ai tips", "ai news recap"], dropped: 6 });
    expect(findIdeasResultSchema.safeParse(answer).success).toBe(true);
  });

  it("answers failed on a timeout or a bridge error, logging the code only", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    generate.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "TIMEOUT",
        message: "No answer to the prompt about claude code.",
        details: {},
      },
    });
    expect(await ideas.suggest(5)).toEqual({ ok: false, problem: "failed" });
    expect(logged).toHaveBeenCalledWith("Find: keyword ideas failed (TIMEOUT).");
    clock += sendGapMs;
    generate.mockRejectedValueOnce(new Error("broken pipe"));
    expect(await ideas.suggest(5)).toEqual({ ok: false, problem: "failed" });
    // A failure frees the next request.
    clock += sendGapMs;
    expect(await ideas.suggest(5)).toMatchObject({ ok: true });
  });

  it("answers failed when no data is open", async () => {
    mode = null;
    expect(await ideas.suggest(5)).toEqual({ ok: false, problem: "failed" });
  });
});
