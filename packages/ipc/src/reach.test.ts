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

  it("takes a cap of 10 to 50 in steps of 5, or a pause, and nothing empty", () => {
    const set = (r: object) => parseRequest("reach:mailbox-set", r).ok;
    const address = "outreach1@gratovo.test";
    expect(set({ address, dailyCap: 35 })).toBe(true);
    expect(set({ address, paused: true })).toBe(true);
    expect(set({ address, dailyCap: 10, paused: false })).toBe(true);
    expect(set({ address, dailyCap: 5 })).toBe(false);
    expect(set({ address, dailyCap: 55 })).toBe(false);
    expect(set({ address, dailyCap: 33 })).toBe(false);
    expect(set({ address })).toBe(false);
    expect(parseRequest("reach:send-test", { address }).ok).toBe(true);
    expect(parseRequest("reach:send-test", { address: "x" }).ok).toBe(false);
  });

  it("takes zones by creator as IANA names only", () => {
    const zones = (z: object) => reachDataSchema.safeParse({ ...emptyReach, zones: z }).success;
    expect(zones({ UCabc: "America/New_York", UCdef: "America/Argentina/Buenos_Aires" })).toBe(
      true,
    );
    expect(zones({ UCabc: "Asia/Ho_Chi_Minh" })).toBe(true);
    expect(zones({ UCabc: "UTC; drop" })).toBe(false);
    expect(zones({ UCabc: "" })).toBe(false);
  });

  it("checks the sequence commands' requests", () => {
    expect(parseRequest("reach:sequence-stop", { creatorId: "UCabc" }).ok).toBe(true);
    expect(parseRequest("reach:wake", { creatorId: "" }).ok).toBe(false);
    expect(parseRequest("reach:park", { creatorId: "UCabc", until: 1_800_000_000_000 }).ok).toBe(
      true,
    );
    expect(parseRequest("reach:park", { creatorId: "UCabc" }).ok).toBe(false);
    expect(parseRequest("reach:park", { creatorId: "UCabc", until: 1e300 }).ok).toBe(false);
    expect(parseRequest("reach:park", { creatorId: "UCabc", until: 1.5 }).ok).toBe(false);
    expect(parseRequest("reach:wake", { creatorId: "UCabc", restore: ["d1", "d2"] }).ok).toBe(true);
    expect(
      parseRequest("reach:sequence-resume", {
        creatorId: "UCabc",
        restore: Array.from({ length: 11 }, (_, i) => `d${String(i)}`),
      }).ok,
    ).toBe(false);
    expect(parseRequest("reach:sequence-resume", { creatorId: "UCabc", extra: 1 }).ok).toBe(false);
  });

  it("checks the replies channels' requests and the fact write", () => {
    expect(parseRequest("reach:paste-reply", { creatorId: "UCabc", text: "Sounds good!" }).ok).toBe(
      true,
    );
    expect(parseRequest("reach:paste-reply", { creatorId: "UCabc", text: "   " }).ok).toBe(false);
    expect(
      parseRequest("reach:paste-reply", { creatorId: "UCabc", text: "x".repeat(20_001) }).ok,
    ).toBe(false);
    expect(
      parseRequest("reach:reclassify", { messageId: "m1", replyType: "inf.interested_vague" }).ok,
    ).toBe(true);
    expect(parseRequest("reach:reclassify", { messageId: "m1", replyType: "DROP TABLE" }).ok).toBe(
      false,
    );
    expect(parseRequest("reach:check-replies", {}).ok).toBe(true);
    const fact = (w: object) => dataWriteSchema.safeParse(w).success;
    expect(fact({ kind: "reply.fact", messageId: "m1", key: "rate" })).toBe(true);
    expect(fact({ kind: "reply.fact", messageId: "m1", key: "email" })).toBe(false);
  });
});
