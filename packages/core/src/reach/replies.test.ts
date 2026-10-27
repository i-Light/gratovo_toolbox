import { describe, expect, it } from "vitest";

import type { Creator, OutreachDraft, ThreadSummary } from "../data";
import { repliesToAnswer, replyItems } from "./replies";

const creator = (id: string, name = id): Creator => ({
  id,
  name,
  handle: `@${id}`,
  stage: "replied",
  email: `${id}@ai.test`,
  emailConfirmed: true,
  contactName: null,
  contactSource: null,
  contactConfidence: null,
  rejectReason: null,
  rejectedAt: null,
  neverReason: null,
  archiveDueAt: null,
  kit: null,
});

const thread = (
  who: string,
  at: number | null,
  over: Partial<ThreadSummary> = {},
): ThreadSummary => ({
  creator: who,
  count: 2,
  lastOutAt: 1,
  lastIn:
    at === null ? null : { id: `in-${who}`, at, reading: null, preview: "Hi!", bounce: false },
  answered: false,
  ...over,
});

const answer = (id: string, who: string, over: Partial<OutreachDraft> = {}): OutreachDraft => ({
  id,
  creator: who,
  kind: "reply",
  followUp: null,
  state: "ready",
  subject: "Re: your video",
  body: "Thanks!",
  mailbox: "outreach1@gratovo.example",
  sendAt: null,
  proposal: null,
  gatesOk: [],
  edited: false,
  checked: true,
  rewriting: null,
  replyTo: `in-${who}`,
  goal: null,
  problem: null,
  createdAt: 5,
  updatedAt: 5,
  ...over,
});

describe("replyItems", () => {
  it("lists each creator who wrote back, newest first, with where it stands", () => {
    const items = replyItems(
      [creator("a"), creator("b"), creator("c"), creator("d"), creator("e"), creator("f")],
      [
        thread("a", 10),
        thread("b", 30),
        thread("c", 20, { answered: true }),
        thread("d", 40),
        thread("e", null),
        thread("f", 50, {
          lastIn: { id: "x", at: 50, reading: null, preview: "", bounce: true },
        }),
        thread("ghost", 60),
      ],
      [
        answer("q1", "b"),
        answer("q2", "d", { state: "drafting" }),
        answer("q3", "a", { state: "sent" }),
      ],
    );
    expect(items.map((i) => [i.creator.id, i.state])).toEqual([
      ["f", "bounced"],
      ["d", "writing"],
      ["b", "draft"],
      ["c", "answered"],
      ["a", "your_move"],
    ]);
    expect(items.find((i) => i.creator.id === "b")?.draft?.id).toBe("q1");
    expect(repliesToAnswer(items)).toBe(2);
  });

  it("closes a reply from a creator marked never contact or rejected: nothing waits on you", () => {
    const items = replyItems(
      [
        { ...creator("n"), stage: "never" },
        { ...creator("r"), stage: "rejected" },
      ],
      [thread("n", 10), thread("r", 20)],
      [],
    );
    expect(items.map((i) => i.state)).toEqual(["closed", "closed"]);
    expect(repliesToAnswer(items)).toBe(0);
  });
});
