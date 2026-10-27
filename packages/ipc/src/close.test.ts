import { describe, expect, it } from "vitest";

import { channels, parseRequest } from "./channels";
import { sequenceRestoreMax } from "./reach";

describe("the close channels", () => {
  it("decline and ask take a creator id and nothing else", () => {
    expect(parseRequest("close:decline", { creatorId: "UC1" }).ok).toBe(true);
    expect(parseRequest("close:ask", { creatorId: "UC1" }).ok).toBe(true);
    expect(parseRequest("close:decline", {}).ok).toBe(false);
    expect(parseRequest("close:ask", { creatorId: "UC1", extra: 1 }).ok).toBe(false);
  });

  it("decline-undo limits the stage to the signing stages and the skipped list", () => {
    const base = { creatorId: "UC1", draftId: "d1", before: "replied", skipped: ["d0"] };
    expect(parseRequest("close:decline-undo", base).ok).toBe(true);
    expect(parseRequest("close:decline-undo", { ...base, draftId: null }).ok).toBe(true);
    expect(parseRequest("close:decline-undo", { ...base, before: "signed" }).ok).toBe(false);
    const many = Array.from({ length: sequenceRestoreMax + 1 }, (_, i) => `d${String(i)}`);
    expect(parseRequest("close:decline-undo", { ...base, skipped: many }).ok).toBe(false);
  });

  it("answers with the shapes in the plan", () => {
    const decline = channels["close:decline"].response;
    expect(decline.safeParse({ ok: true, draftId: null, before: "kit", skipped: [] }).success).toBe(
      true,
    );
    expect(decline.safeParse({ ok: false, problem: "wrong_state" }).success).toBe(true);
    expect(decline.safeParse({ ok: false, problem: "draft_open" }).success).toBe(false);
    const ask = channels["close:ask"].response;
    expect(ask.safeParse({ ok: false, problem: "nothing_missing" }).success).toBe(true);
    expect(ask.safeParse({ ok: true, draftId: null }).success).toBe(false);
  });
});
