import { scenarios } from "@gratovo/core/data";
import { describe, expect, it } from "vitest";

import {
  commentAnchorSchema,
  commentNewSchema,
  commentPatchSchema,
  commentSchema,
  commentTextMax,
  scenarioKeys,
} from "./prototype";

const anchor = {
  ui: "find.search.list",
  path: "div:nth-of-type(2) > button:nth-of-type(1)",
  tag: "button",
  text: "Run today's search",
  label: "Run search button",
  rx: 0.5,
  ry: 0.25,
};
const place = { global: false, screen: "find", tab: "search", record: null, peek: null };
const newComment = { kind: "fix", text: "Make this clearer", place, anchor };
const comment = {
  ...newComment,
  id: "cabc123def",
  at: 1_700_000_000_000,
  status: "open",
  doneAt: null,
  scenario: "normal",
};

describe("scenarioKeys", () => {
  it("matches core's scenarios", () => {
    expect([...scenarioKeys]).toEqual([...scenarios]);
  });
});

describe("commentSchema", () => {
  it("accepts a valid comment", () => {
    expect(commentSchema.safeParse(comment).success).toBe(true);
  });

  it("refuses a bad id, an empty text and an unknown key", () => {
    expect(commentSchema.safeParse({ ...comment, id: "Bad Id" }).success).toBe(false);
    expect(commentSchema.safeParse({ ...comment, text: "   " }).success).toBe(false);
    expect(commentSchema.safeParse({ ...comment, extra: 1 }).success).toBe(false);
  });
});

describe("commentNewSchema", () => {
  it("accepts a new comment and refuses a text that is too long", () => {
    expect(commentNewSchema.safeParse(newComment).success).toBe(true);
    const long = "a".repeat(commentTextMax + 1);
    expect(long).toHaveLength(4001);
    expect(commentNewSchema.safeParse({ ...newComment, text: long }).success).toBe(false);
  });

  it("refuses an unknown key", () => {
    expect(commentNewSchema.safeParse({ ...newComment, id: "cabc123def" }).success).toBe(false);
  });
});

describe("commentPatchSchema", () => {
  it("accepts a text or a status change", () => {
    expect(commentPatchSchema.safeParse({ id: "cabc123def", status: "done" }).success).toBe(true);
    expect(commentPatchSchema.safeParse({ id: "cabc123def", text: "New" }).success).toBe(true);
  });

  it("refuses a bad id, an empty text and an unknown key", () => {
    expect(commentPatchSchema.safeParse({ id: "x", status: "done" }).success).toBe(false);
    expect(commentPatchSchema.safeParse({ id: "cabc123def", text: "" }).success).toBe(false);
    expect(commentPatchSchema.safeParse({ id: "cabc123def", note: 1 }).success).toBe(false);
  });
});

describe("commentAnchorSchema", () => {
  it("accepts a valid anchor and a null ui", () => {
    expect(commentAnchorSchema.safeParse(anchor).success).toBe(true);
    expect(commentAnchorSchema.safeParse({ ...anchor, ui: null }).success).toBe(true);
  });

  it("refuses rx 1.5, a ui with capitals and an unknown key", () => {
    expect(commentAnchorSchema.safeParse({ ...anchor, rx: 1.5 }).success).toBe(false);
    expect(commentAnchorSchema.safeParse({ ...anchor, ui: "Find.Search" }).success).toBe(false);
    expect(commentAnchorSchema.safeParse({ ...anchor, extra: true }).success).toBe(false);
    expect(commentAnchorSchema.safeParse({ ...anchor, tag: "1a" }).success).toBe(false);
    expect(commentAnchorSchema.safeParse({ ...anchor, tag: "h1" }).success).toBe(true);
  });
});
