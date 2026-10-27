// @vitest-environment happy-dom
import type { Comment, PrototypeStatus } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addComment,
  commentsForClaude,
  deleteComment,
  exportComments,
  getPrototype,
  isPrototypeOn,
  loadPrototype,
  patchComment,
  pickScenario,
  resetPrototypeForTests,
  restoreComment,
  setPrototype,
  takeSwitchToast,
  toggleCommenting,
} from "./prototype";

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

let calls: string[] = [];
function bridge(status: PrototypeStatus, list: Comment[] = []) {
  calls = [];
  const invoke = vi.fn((channel: string, input: unknown) => {
    calls.push(channel);
    switch (channel) {
      case "prototype:status":
      case "prototype:set":
      case "prototype:scenario":
        return Promise.resolve({ ok: true, value: status });
      case "comments:list":
        return Promise.resolve({ ok: true, value: { comments: list } });
      case "comments:add":
      case "comments:update":
        return Promise.resolve({ ok: true, value: comment({ ...(input as object) }) });
      case "comments:delete":
        return Promise.resolve({ ok: true, value: { comment: list[0] ?? null } });
      case "comments:restore":
        return Promise.resolve({ ok: true, value: (input as { comment: Comment }).comment });
      case "comments:export":
        return Promise.resolve({
          ok: true,
          value: { ok: true, path: "docs/feedback/comments.json", count: 1 },
        });
      default:
        return Promise.resolve({ ok: false, reason: "x" });
    }
  });
  (globalThis as { gratovo?: unknown }).gratovo = { invoke };
  return invoke;
}

const off: PrototypeStatus = { available: true, on: false, scenario: "normal" };
const on: PrototypeStatus = { available: true, on: true, scenario: "normal" };
const fresh = () => ({
  kind: "fix" as const,
  text: "Make this bigger",
  place: comment().place,
  anchor: comment().anchor,
});

beforeEach(() => {
  resetPrototypeForTests();
  sessionStorage.clear();
});
afterEach(() => {
  delete (globalThis as { gratovo?: unknown }).gratovo;
});

describe("loading", () => {
  it("asks for the status only when prototype mode is off", async () => {
    bridge(off);
    await loadPrototype();
    expect(calls).toEqual(["prototype:status"]);
    expect(isPrototypeOn()).toBe(false);
    expect(getPrototype().status).toEqual(off);
  });

  it("reads the comments too when it is on", async () => {
    bridge(on, [comment()]);
    await loadPrototype();
    expect(calls).toEqual(["prototype:status", "comments:list"]);
    expect(getPrototype().comments).toHaveLength(1);
  });
});

describe("comment actions", () => {
  it("do nothing, and call nothing, while prototype mode is off", async () => {
    bridge(off);
    await loadPrototype();
    calls.length = 0;
    expect(await addComment(fresh())).toBeNull();
    expect(await patchComment({ id: "cabc123456", text: "y" })).toBeNull();
    expect(await deleteComment("cabc123456")).toBeNull();
    expect(await restoreComment(comment())).toBeNull();
    expect(await exportComments()).toBeNull();
    toggleCommenting(true);
    expect(getPrototype().commenting).toBe(false);
    expect(calls).toEqual([]);
  });

  it("add, patch, delete and restore keep the list in step while it is on", async () => {
    bridge(on);
    await loadPrototype();
    const added = await addComment(fresh());
    expect(added?.id).toBe("cabc123456");
    expect(getPrototype().comments).toHaveLength(1);
    await patchComment({ id: "cabc123456", status: "done" });
    expect(getPrototype().comments).toHaveLength(1);
    bridge(on, [comment()]);
    await deleteComment("cabc123456");
    expect(getPrototype().comments).toHaveLength(0);
    await restoreComment(comment());
    expect(getPrototype().comments).toHaveLength(1);
    expect((await exportComments())?.ok).toBe(true);
    toggleCommenting();
    expect(getPrototype().commenting).toBe(true);
  });
});

describe("the switch toast", () => {
  it("is written before a switch and taken once", async () => {
    bridge(off);
    await setPrototype(true);
    expect(takeSwitchToast()?.msg).toBe("Prototype mode is on");
    expect(takeSwitchToast()).toBeNull();
    await setPrototype(false);
    expect(takeSwitchToast()?.msg).toBe("Prototype mode is off");
    await pickScenario("broke");
    expect(takeSwitchToast()?.msg).toBe("Scenario: Something broke");
  });

  it("is dropped when the switch fails", async () => {
    (globalThis as { gratovo?: unknown }).gratovo = {
      invoke: () => Promise.resolve({ ok: false, reason: "x" }),
    };
    await setPrototype(true);
    expect(takeSwitchToast()).toBeNull();
  });
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
