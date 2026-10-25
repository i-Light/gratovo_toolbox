import { describe, expect, it } from "vitest";

import type { Creator, CreatorStage, OutreachDraft, Sequence, ThreadSummary } from "../data";

import { boardLanes, nextStep, openDrafts } from "./board";
import type { BoardInput } from "./board";

const creator = (id: string, stage: CreatorStage, name = id): Creator => ({
  id,
  name,
  handle: `@${id}`,
  stage,
  email: `${id}@ai.test`,
  emailConfirmed: true,
  contactName: null,
  contactSource: null,
  contactConfidence: null,
  rejectReason: null,
  rejectedAt: null,
  neverReason: null,
  archiveDueAt: null,
});

const draft = (id: string, who: string, over: Partial<OutreachDraft> = {}): OutreachDraft => ({
  id,
  creator: who,
  kind: "first",
  followUp: null,
  state: "ready",
  subject: "",
  body: "",
  mailbox: null,
  sendAt: null,
  proposal: null,
  gatesOk: [],
  edited: false,
  checked: true,
  rewriting: null,
  replyTo: null,
  problem: null,
  createdAt: 100,
  updatedAt: 100,
  ...over,
});

const base = (over: Partial<BoardInput> = {}): BoardInput => ({
  creators: [],
  drafts: [],
  threads: [],
  sequences: [],
  source: "live",
  ...over,
});

const lane = (input: BoardInput, key: string): string[] =>
  boardLanes(input)
    .find((l) => l.key === key)
    ?.items.map((i) => i.creator.id) ?? [];

describe("boardLanes", () => {
  it("shows four lanes live and six on example data", () => {
    expect(boardLanes(base()).map((l) => l.key)).toEqual(["todraft", "waiting", "seq", "replied"]);
    expect(boardLanes(base({ source: "example" })).map((l) => l.key)).toEqual([
      "todraft",
      "waiting",
      "seq",
      "replied",
      "kit",
      "signed",
    ]);
  });

  it("puts each creator in the lane of its open draft, else of its stage", () => {
    const input = base({
      source: "example",
      creators: [
        creator("a", "contact"),
        creator("b", "contact"),
        creator("c", "contact"),
        creator("d", "emailed"),
        creator("e", "emailed"),
        creator("f", "replied"),
        creator("g", "emailed"),
        creator("h", "kit"),
        creator("i", "signed"),
        creator("j", "shortlisted"),
        creator("k", "parked"),
      ],
      drafts: [
        draft("q1", "b", { state: "drafting" }),
        draft("q2", "c", { state: "ready" }),
        draft("q3", "e", { kind: "followUp", followUp: 1, state: "ready" }),
        draft("q4", "g", { kind: "reply", state: "ready" }),
        draft("q5", "d", { kind: "followUp", followUp: 1, state: "drafting" }),
        draft("q6", "a", { state: "sent" }),
      ],
    });
    expect(lane(input, "todraft")).toEqual(["b", "a"]);
    expect(lane(input, "waiting")).toEqual(["c", "e"]);
    expect(lane(input, "seq")).toEqual(["d", "k"]);
    expect(lane(input, "replied")).toEqual(["f", "g"]);
    expect(lane(input, "kit")).toEqual(["h"]);
    expect(lane(input, "signed")).toEqual(["i"]);
  });

  it("orders In sequence by the next step due, and Replied by the newest reply", () => {
    const seq = (who: string, dueAt: number): Sequence => ({
      creator: who,
      mailbox: "m@gratovo.test",
      startedAt: 0,
      steps: [{ n: 1, dueAt, state: "planned", sentAt: null }],
      stopped: null,
      parkUntil: null,
    });
    const thread = (who: string, at: number): ThreadSummary => ({
      creator: who,
      count: 2,
      lastOutAt: 1,
      lastIn: { id: `m${who}`, at, reading: null, preview: "", bounce: false },
      answered: false,
    });
    const input = base({
      creators: [
        creator("x", "emailed"),
        creator("y", "emailed"),
        creator("r1", "replied"),
        creator("r2", "replied"),
      ],
      sequences: [seq("x", 900), seq("y", 300)],
      threads: [thread("r1", 10), thread("r2", 20)],
    });
    expect(lane(input, "seq")).toEqual(["y", "x"]);
    expect(lane(input, "replied")).toEqual(["r2", "r1"]);
  });
});

describe("openDrafts and nextStep", () => {
  it("keeps each creator's newest open draft", () => {
    const open = openDrafts([
      draft("old", "a", { createdAt: 1 }),
      draft("new", "a", { createdAt: 2 }),
      draft("gone", "b", { state: "skipped" }),
    ]);
    expect(open.get("a")?.id).toBe("new");
    expect(open.has("b")).toBe(false);
  });

  it("names no next step for a stopped sequence", () => {
    const s: Sequence = {
      creator: "a",
      mailbox: "m@gratovo.test",
      startedAt: 0,
      steps: [
        { n: 1, dueAt: 1, state: "sent", sentAt: 1 },
        { n: 2, dueAt: 2, state: "planned", sentAt: null },
      ],
      stopped: null,
      parkUntil: null,
    };
    expect(nextStep(s)?.n).toBe(2);
    expect(nextStep({ ...s, stopped: "you" })).toBeNull();
    expect(nextStep(null)).toBeNull();
  });
});
