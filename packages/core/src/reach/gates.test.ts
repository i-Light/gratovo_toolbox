import { describe, expect, it } from "vitest";

import type { DraftProposal, MailboxView } from "../data";

import { canSchedule, canSend, draftGates, mailboxGate, pickMailbox } from "./gates";
import type { GateInput } from "./gates";

const proposal = (over: Partial<DraftProposal> = {}): DraftProposal => ({
  status: "ready",
  why: "One real moment from their latest video.",
  rules: ["INF-FIRST-02"],
  findings: [],
  gates: [],
  situation: null,
  model: null,
  ...over,
});

const box = (over: Partial<MailboxView> = {}): MailboxView => ({
  address: "outreach1@gratovo.test",
  connected: true,
  signedOut: false,
  dailyCap: 30,
  effectiveCap: 30,
  sentToday: 4,
  leftToday: 26,
  warmup: null,
  paused: false,
  status: "good",
  bounceRate: null,
  replyRate: null,
  checkedAt: null,
  ...over,
});

const input = (over: Partial<GateInput> = {}): GateInput => ({
  draft: { kind: "first", proposal: proposal(), gatesOk: [], mailbox: "outreach1@gratovo.test" },
  creator: { stage: "contact", emailConfirmed: true, email: "kai@codewithkai.test" },
  mailbox: box(),
  ...over,
});

const keys = (i: GateInput): string[] => draftGates(i).map((g) => g.key);

describe("draftGates", () => {
  it("is empty for a confirmed creator, a mailbox with room and a clean proposal", () => {
    const gates = draftGates(input());
    expect(gates).toEqual([]);
    expect(canSend(gates)).toBe(true);
    expect(canSchedule(gates)).toBe(true);
  });

  it("holds both ways for never contact, with no override", () => {
    const gates = draftGates(
      input({ creator: { stage: "never", emailConfirmed: true, email: "a@b.co" } }),
    );
    expect(gates.map((g) => g.key)).toEqual(["never"]);
    expect(canSend(gates)).toBe(false);
    expect(canSchedule(gates)).toBe(false);
  });

  it("holds an unconfirmed address and a missing one", () => {
    expect(
      keys(input({ creator: { stage: "contact", emailConfirmed: false, email: "a@b.co" } })),
    ).toEqual(["unconfirmed"]);
    expect(
      keys(input({ creator: { stage: "contact", emailConfirmed: true, email: null } })),
    ).toEqual(["unconfirmed"]);
  });

  it("lets a full or paused mailbox take a later send but not a send now", () => {
    for (const mailbox of [box({ leftToday: 0 }), box({ paused: true })]) {
      const gates = draftGates(input({ mailbox }));
      expect(canSend(gates)).toBe(false);
      expect(canSchedule(gates)).toBe(true);
    }
  });

  it("holds both ways without a mailbox or with a signed-out one", () => {
    for (const mailbox of [null, box({ connected: false }), box({ signedOut: true })]) {
      const gates = draftGates(input({ mailbox }));
      expect(canSend(gates)).toBe(false);
      expect(canSchedule(gates)).toBe(false);
    }
    expect(keys(input({ mailbox: box({ signedOut: true }) }))).toEqual(["mailbox_signed_out"]);
  });

  it("holds a draft still being written, a blocked one and one with a blocking finding", () => {
    const draft = input().draft;
    expect(keys(input({ draft: { ...draft, proposal: null } }))).toEqual(["blocked"]);
    expect(keys(input({ draft: { ...draft, proposal: proposal({ status: "blocked" }) } }))).toEqual(
      ["blocked"],
    );
    const finding = { rule: "FND-WRITE-11", text: "Banned word", blocking: true };
    expect(
      keys(input({ draft: { ...draft, proposal: proposal({ findings: [finding] }) } })),
    ).toEqual(["blocked"]);
    const advice = { ...finding, blocking: false };
    expect(
      keys(input({ draft: { ...draft, proposal: proposal({ findings: [advice] }) } })),
    ).toEqual([]);
  });

  it("holds each engine gate until a person confirms it", () => {
    const gates = [
      { key: "g1", kind: "price" as const, text: "It names a rate." },
      { key: "g2", kind: "claim" as const, text: "It claims a past campaign." },
    ];
    const draft = { ...input().draft, proposal: proposal({ status: "needs_human", gates }) };
    expect(draftGates(input({ draft })).map((g) => g.engine?.key)).toEqual(["g1", "g2"]);
    expect(
      draftGates(input({ draft: { ...draft, gatesOk: ["g1"] } })).map((g) => g.engine?.key),
    ).toEqual(["g2"]);
    expect(draftGates(input({ draft: { ...draft, gatesOk: ["g1", "g2"] } }))).toEqual([]);
  });

  it("keeps the order: never, address, mailbox, checks, engine", () => {
    const draft = {
      ...input().draft,
      proposal: proposal({
        status: "blocked",
        gates: [{ key: "g", kind: "terms", text: "Terms" }],
      }),
    };
    expect(
      keys({
        draft,
        creator: { stage: "never", emailConfirmed: false, email: null },
        mailbox: box({ paused: true }),
      }),
    ).toEqual(["never", "unconfirmed", "mailbox_paused", "blocked", "engine"]);
  });
});

describe("mailboxGate and pickMailbox", () => {
  it("names why a mailbox can't send", () => {
    expect(mailboxGate(box())).toBeNull();
    expect(mailboxGate(null)).toBe("no_mailbox");
    expect(mailboxGate(box({ signedOut: true, paused: true }))).toBe("mailbox_signed_out");
    expect(mailboxGate(box({ paused: true, leftToday: 0 }))).toBe("mailbox_paused");
    expect(mailboxGate(box({ leftToday: 0 }))).toBe("mailbox_full");
  });

  it("picks the mailbox with the most sends left, else the first connected one", () => {
    const a = box({ address: "a@gratovo.test", leftToday: 5 });
    const b = box({ address: "b@gratovo.test", leftToday: 12 });
    const full = box({ address: "c@gratovo.test", leftToday: 0 });
    expect(pickMailbox([a, b, full])).toBe("b@gratovo.test");
    expect(pickMailbox([full])).toBe("c@gratovo.test");
    expect(pickMailbox([box({ connected: false })])).toBeNull();
    expect(pickMailbox([])).toBeNull();
  });
});
