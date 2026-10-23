import { describe, expect, it } from "vitest";

import {
  type GeminiParams,
  geminiMethods,
  geminiRequestLine,
  maxGeminiLineLength,
  parseGeminiLine,
  readGeminiResult,
} from "./gemini-protocol";

describe("parseGeminiLine", () => {
  it("reads a response, an error and an event", () => {
    const ok = parseGeminiLine(
      JSON.stringify({ type: "response", id: "r1", ok: true, result: { ok: true } }),
    );
    expect(ok).toEqual({
      ok: true,
      line: { type: "response", id: "r1", ok: true, result: { ok: true } },
    });

    const failed = parseGeminiLine(
      JSON.stringify({
        type: "response",
        id: "r2",
        ok: false,
        error: {
          code: "EXTENSION_NOT_CONNECTED",
          message: "no extension",
          details: { port: 8765 },
        },
      }),
    );
    expect(failed.ok).toBe(true);

    const event = parseGeminiLine(
      JSON.stringify({
        type: "event",
        event: "daemon",
        data: { state: "listening", port: 8765, pid: 12, version: "0.1.0" },
      }),
    );
    expect(event.ok).toBe(true);
  });

  it("answers a bad-JSON request with a null id", () => {
    const line = JSON.stringify({
      type: "response",
      id: null,
      ok: false,
      error: { code: "BAD_PARAMS", message: "not JSON", details: {} },
    });
    expect(parseGeminiLine(line).ok).toBe(true);
  });

  it("refuses an unknown error code, an unknown event and extra fields", () => {
    const unknownCode = {
      type: "response",
      id: "r",
      ok: false,
      error: { code: "WHATEVER", message: "", details: {} },
    };
    expect(parseGeminiLine(JSON.stringify(unknownCode))).toEqual({
      ok: false,
      problem: "bad_message",
    });
    expect(parseGeminiLine(JSON.stringify({ type: "event", event: "secret", data: {} })).ok).toBe(
      false,
    );
    expect(
      parseGeminiLine(
        JSON.stringify({ type: "response", id: "r", ok: true, result: 1, extra: true }),
      ).ok,
    ).toBe(false);
  });

  it("refuses text that isn't JSON and lines that are too long", () => {
    expect(parseGeminiLine("listening on 8765")).toEqual({ ok: false, problem: "not_json" });
    expect(parseGeminiLine("x".repeat(maxGeminiLineLength + 1))).toEqual({
      ok: false,
      problem: "too_long",
    });
  });
});

describe("geminiRequestLine", () => {
  it("writes one checked line", () => {
    const line = geminiRequestLine("7", "action.generate_keywords", {
      topic: "AI coding tools",
      count: 50,
      chats: 2,
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      id: "7",
      method: "action.generate_keywords",
      params: { topic: "AI coding tools", count: 50, chats: 2 },
    });
  });

  it("throws on params the method doesn't take", () => {
    expect(() =>
      geminiRequestLine("1", "action.skill_delete", { name: "gratovo-comms" } as never),
    ).toThrow();
    expect(() => geminiRequestLine("1", "bridge.status", { extra: 1 } as never)).toThrow();
  });

  it("writes a comms request with main's facts, and refuses a brand price in the deal", () => {
    const facts: GeminiParams<"action.comms_propose">["facts"] = {
      agency: null,
      thread: {
        id: "t1",
        channelId: "UC_a",
        brandId: null,
        contactEmail: "sam@example.com",
        dealId: "d1",
        messages: [
          { direction: "inbound", subject: "Re: hi", body: "What do you pay?", at: "2026-10-16" },
        ],
      },
      creators: { UC_a: { pipelineStage: "negotiating", mediaKit: null, creatorGender: null } },
      brand: null,
      deal: {
        brandName: "Wispr Flow",
        stage: "negotiating",
        creatorReceives: 1200,
        currency: "USD",
        deliverables: null,
        deadline: null,
        paymentTerms: null,
      },
      recentOutbound: ["Hi Sam, saw your test."],
    };
    const request: GeminiParams<"action.comms_propose">["request"] = {
      kind: "reply",
      threadId: "t1",
      steer: { english: "nonnative" },
    };
    const sent = (line: string) => JSON.parse(line) as { method: string; params: unknown };

    const line = geminiRequestLine("c1", "action.comms_propose", { request, facts });
    expect(sent(line).params).toEqual({ request, facts });
    const check = geminiRequestLine("c2", "action.comms_check", {
      request,
      facts,
      subject: "Re: hi",
      body: "Hi Sam,\n\nWhat do you usually charge?\n\nMoustafa",
    });
    expect(sent(check).method).toBe("action.comms_check");

    const priced = { ...facts, deal: { ...facts.deal, brandPrice: 3000 } };
    expect(() =>
      geminiRequestLine("c3", "action.comms_propose", { request, facts: priced } as never),
    ).toThrow();
    expect(() =>
      geminiRequestLine("c4", "action.comms_propose", {
        request: {
          ...request,
          pitchChannelIds: Array.from({ length: 11 }, (_, i) => `UC_${String(i)}`),
        },
        facts,
      }),
    ).toThrow();
    expect(() =>
      geminiRequestLine("c5", "action.comms_check", { request, facts } as never),
    ).toThrow();
  });

  it("knows none of the retired drafting actions", () => {
    for (const retired of ["draft_email", "qa_email", "lint_email", "draft_reply", "parse_draft"]) {
      expect(geminiMethods).not.toContain(`action.${retired}`);
    }
  });
});

describe("readGeminiResult", () => {
  it("keeps a result that fits, extra fields included", () => {
    const result = readGeminiResult("action.classify_channel", {
      niche: "AI coding tools",
      audience: "developers",
      language: "en",
      brandFit: 4,
      reasons: ["covers Claude Code weekly"],
      redFlags: [],
      raw: "{}",
      model: "Pro",
      extra: "kept",
    });
    expect(result).toMatchObject({ brandFit: 4, extra: "kept" });
  });

  it("reads a comms proposal and a check", () => {
    const finding = {
      code: "COURSE_CHECK_SKIPPED",
      severity: "warn",
      rule: "FND-WRITE-15",
      detail: "d",
    };
    const proposal = readGeminiResult("action.comms_propose", {
      status: "blocked",
      proposal: null,
      findings: [finding],
      gates: [],
      case: { side: "influencer", stage: "replied", goal: "Decide the next step." },
      moments: [],
      momentsNote: null,
      seconds: 0,
      model: null,
      thinking: null,
    });
    expect(proposal?.status).toBe("blocked");
    expect(
      readGeminiResult("action.comms_check", { findings: [finding], gates: [], blocking: false }),
    ).toMatchObject({ blocking: false });

    expect(readGeminiResult("action.comms_propose", { status: "sent" })).toBeNull();
    expect(
      readGeminiResult("action.comms_check", {
        findings: [{ code: 1 }],
        gates: [],
        blocking: true,
      }),
    ).toBeNull();
  });

  it("returns null for one that doesn't", () => {
    expect(readGeminiResult("action.classify_channel", { brandFit: 9 })).toBeNull();
    expect(readGeminiResult("bridge.shutdown", { ok: false })).toBeNull();
  });
});
