import { emptyReach } from "@gratovo/core/data";
import { describe, expect, it } from "vitest";

import { parseRequest } from "./channels";
import { dataWriteSchema } from "./data";
import { outreachDraftSchema, reachDataSchema } from "./reach";

const draft = {
  id: "d1",
  creator: "UCabc",
  kind: "first",
  followUp: null,
  state: "ready",
  subject: "your agent demo",
  body: "Hi Kai,\n\nThe agent demo at 4:10 stuck with me.",
  mailbox: "outreach1@gratovo.test",
  sendAt: null,
  proposal: null,
  gatesOk: [],
  edited: false,
  checked: true,
  rewriting: null,
  replyTo: null,
  problem: null,
  createdAt: 1,
  updatedAt: 1,
};

describe("the reach schemas", () => {
  it("takes an empty reach and a draft, and refuses an unknown state", () => {
    expect(reachDataSchema.safeParse(emptyReach).success).toBe(true);
    expect(outreachDraftSchema.safeParse(draft).success).toBe(true);
    expect(outreachDraftSchema.safeParse({ ...draft, state: "queued" }).success).toBe(false);
    expect(outreachDraftSchema.safeParse({ ...draft, extra: 1 }).success).toBe(false);
  });

  it("gives a send time to Send and Send later only", () => {
    const write = (state: string, sendAt: number | null) =>
      dataWriteSchema.safeParse({ kind: "draft.state", id: "d1", state, sendAt }).success;
    expect(write("approved", 10_000)).toBe(true);
    expect(write("scheduled", 10_000)).toBe(true);
    expect(write("ready", null)).toBe(true);
    expect(write("skipped", null)).toBe(true);
    expect(write("approved", null)).toBe(false);
    expect(write("ready", 10_000)).toBe(false);
    // Only main sets these.
    expect(write("sending", null)).toBe(false);
    expect(write("sent", null)).toBe(false);
  });

  it("takes a mailbox only as an address, and a gate by key", () => {
    const ok = (w: object) => dataWriteSchema.safeParse(w).success;
    expect(ok({ kind: "draft.mailbox", id: "d1", mailbox: "a@gratovo.test" })).toBe(true);
    expect(ok({ kind: "draft.mailbox", id: "d1", mailbox: null })).toBe(true);
    expect(ok({ kind: "draft.mailbox", id: "d1", mailbox: "not an address" })).toBe(false);
    expect(ok({ kind: "draft.gate", id: "d1", gate: "g1", ok: true })).toBe(true);
    expect(ok({ kind: "draft.text", id: "d1", subject: "s", body: "b".repeat(20_001) })).toBe(
      false,
    );
  });

  it("checks the reach channels' requests", () => {
    expect(parseRequest("reach:thread", { creatorId: "UCabc" }).ok).toBe(true);
    expect(parseRequest("reach:thread", {}).ok).toBe(false);
    expect(parseRequest("reach:rewrite", { draftId: "d1", how: "warmer" }).ok).toBe(true);
    expect(parseRequest("reach:rewrite", { draftId: "d1", how: "louder" }).ok).toBe(false);
    expect(parseRequest("reach:mailboxes-refresh", {}).ok).toBe(true);
  });
});
