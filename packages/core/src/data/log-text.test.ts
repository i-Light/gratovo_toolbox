import { describe, expect, it } from "vitest";

import { logPhrases, logText, logTextMax } from "./log-text";
import type { LogTextRow } from "./log-text";

function row(over: Partial<LogTextRow>): LogTextRow {
  return {
    action: "updated",
    entityType: "channel",
    entityLabel: "@ai_weekly",
    field: null,
    oldValue: null,
    newValue: null,
    detail: null,
    ...over,
  };
}

describe("logText", () => {
  it("prefers detail.text", () => {
    expect(
      logText(row({ action: "note", entityType: "app", detail: { text: "Renamed the board" } })),
    ).toBe("Renamed the board");
    expect(logText(row({ detail: { text: "Picked up the Acme AI deal" } }))).toBe(
      "Picked up the Acme AI deal",
    );
  });

  it("reads an app line without detail as its action", () => {
    expect(logText(row({ entityType: "app", action: "Opened the board" }))).toBe(
      "Opened the board",
    );
  });

  it("has a phrase for every known legacy action", () => {
    for (const action of Object.keys(logPhrases)) {
      const text = logText(row({ action }));
      expect(text).toContain("@ai_weekly");
      expect(text).not.toContain("{label}");
    }
    expect(Object.keys(logPhrases)).toHaveLength(13);
  });

  it("adds old to new when both are present", () => {
    expect(logText(row({ action: "stageChanged", oldValue: "new", newValue: "contacted" }))).toBe(
      "Changed the stage of @ai_weekly: new → contacted",
    );
    expect(logText(row({ action: "stageChanged", oldValue: "new" }))).toBe(
      "Changed the stage of @ai_weekly",
    );
  });

  it("falls back for an unknown action", () => {
    expect(logText(row({ action: "somethingNew" }))).toBe("Changed @ai_weekly");
    expect(logText(row({ action: "somethingNew", entityLabel: null }))).toBe("Changed something");
    expect(logText(row({ action: "created", entityLabel: null }))).toBe("Added");
  });

  it("ignores a detail without a text string", () => {
    expect(logText(row({ action: "created", detail: { text: 4 } }))).toBe("Added @ai_weekly");
    expect(logText(row({ action: "created", detail: ["x"] }))).toBe("Added @ai_weekly");
  });

  it("caps the text", () => {
    expect(logText(row({ detail: { text: "a".repeat(900) } }))).toHaveLength(logTextMax);
    expect(
      logText(
        row({ action: "stageChanged", oldValue: "a".repeat(400), newValue: "b".repeat(400) }),
      ),
    ).toHaveLength(logTextMax);
  });
});
