import { describe, expect, it } from "vitest";

import {
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

  it("returns null for one that doesn't", () => {
    expect(readGeminiResult("action.classify_channel", { brandFit: 9 })).toBeNull();
    expect(readGeminiResult("bridge.shutdown", { ok: false })).toBeNull();
  });
});
