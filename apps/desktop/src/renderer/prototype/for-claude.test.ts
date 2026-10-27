// @vitest-environment happy-dom
import type { Comment } from "@gratovo/ipc";
import { describe, expect, it } from "vitest";

import { commentsForClaude } from "./for-claude";

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: "cabc123456",
  at: 1,
  status: "open",
  doneAt: null,
  kind: "fix",
  text: "Make this bigger",
  scenario: "normal",
  place: { global: false, screen: "find", tab: "triage", record: null, peek: null },
  anchor: {
    ui: "find.triage",
    path: "",
    tag: "button",
    text: "",
    label: "Keep button",
    rx: 0.5,
    ry: 0.5,
  },
  ...over,
});

describe("commentsForClaude", () => {
  it("lists only the open comments, numbered by their place in the list", () => {
    const list = [
      comment({ id: "cdone00001", status: "done", text: "Old" }),
      comment({ text: "Line one\nLine two", scenario: "broke" }),
      comment({
        id: "cglobal001",
        kind: "idea",
        place: { global: true, screen: null, tab: null, record: null, peek: null },
        text: "Nice",
      }),
    ];
    const out = commentsForClaude(list, { now: Date.UTC(2026, 9, 27, 9, 30) });
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^Workbench comments: 2 open comments, copied /);
    expect(lines).toContain("2. [Fix] Find › Review new · Keep button (scenario: Something broke)");
    expect(lines).toContain("   Line one");
    expect(lines).toContain("   Line two");
    expect(lines).toContain("3. [Idea] Everywhere · Keep button");
    expect(out).not.toContain("Old");
  });
});
