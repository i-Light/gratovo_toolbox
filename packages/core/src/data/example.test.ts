import { describe, expect, it } from "vitest";

import { DEAL_FLOW } from "../deal-flow";
import { seesMoney } from "./access";
import { dueSteps } from "../reach/sequence";
import { exampleFrame, exampleSeed, exampleSeedVersion } from "./example";
import { agencyRoles, creatorStages, notificationIcons } from "./types";

/** 20 October 2026, 10:30 local time. */
const now = new Date(2026, 9, 20, 10, 30).getTime();

/** A time on the day of `now` plus `dayOffset` days, at that hour and minute (local time). */
const on = (dayOffset: number, hours: number, minutes: number): number =>
  new Date(2026, 9, 20 + dayOffset, hours, minutes).getTime();

describe("exampleSeed", () => {
  const seed = exampleSeed(now);

  it("has a positive whole version", () => {
    expect(Number.isInteger(exampleSeedVersion)).toBe(true);
    expect(exampleSeedVersion).toBeGreaterThan(0);
  });

  it("seeds the team: your name unset, you with full access, the others basic", () => {
    expect(seed.me).toBe("u1");
    expect(seed.profiles).toEqual([
      { id: "u1", displayName: "", role: "full" },
      { id: "u2", displayName: "Sara", role: "basic" },
      { id: "u3", displayName: "Omar", role: "basic" },
      { id: "u4", displayName: "Lina", role: "basic" },
    ]);
  });

  it("gives every member presence", () => {
    expect(seed.presence).toEqual({
      u1: { status: "online", doing: "Today" },
      u2: { status: "online", doing: "Reach · replies" },
      u3: { status: "online", doing: "Search · keyword 12 of 40" },
      u4: { status: "away", doing: "Away until 13:00" },
    });
  });

  it("gives every member their agency roles: you the Owner, Omar Scout and Outreach", () => {
    expect(seed.access).toEqual([
      { profileId: "u1", roles: ["owner"], seesMoney: true },
      { profileId: "u2", roles: ["deal_lead", "delivery"], seesMoney: true },
      { profileId: "u3", roles: ["scout", "outreach"], seesMoney: false },
      { profileId: "u4", roles: ["scout"], seesMoney: false },
    ]);
    for (const row of seed.access) {
      for (const role of row.roles) {
        expect(agencyRoles).toContain(role);
      }
    }
  });

  it("lets you see money, and not every member", () => {
    const access = (id: string) => seed.access.find((row) => row.profileId === id);
    const mine = access(seed.me);
    expect(mine !== undefined && seesMoney(mine)).toBe(true);
    const omar = access("u3");
    expect(omar !== undefined && seesMoney(omar)).toBe(false);
  });

  it("dates the notifications from `now`, newest first", () => {
    expect(seed.notifications.map((n) => [n.id, n.at])).toEqual([
      ["n1", on(0, 8, 42)],
      ["n2", on(0, 8, 31)],
      ["n4", on(0, 0, 5)],
      ["n3", on(-1, 17, 0)],
      ["n6", on(-1, 11, 0)],
      ["n5", on(-4, 15, 10)],
    ]);
  });

  it("uses only notification icons the contract knows", () => {
    for (const n of seed.notifications) {
      expect(notificationIcons).toContain(n.icon);
    }
  });

  it("starts Omar's run at 09:02 on the day it is asked about", () => {
    expect(seed.mateRun(now)).toEqual({ by: "u3", at: on(0, 9, 2), current: 12, total: 40 });
    expect(seed.mateRun(on(1, 12, 0))).toEqual({
      by: "u3",
      at: on(1, 9, 2),
      current: 12,
      total: 40,
    });
  });

  it("keeps its records consistent: known stages, steps and links, unique ids", () => {
    for (const c of seed.creators) {
      expect(creatorStages).toContain(c.stage);
    }
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    const brandIds = new Set(seed.brands.map((b) => b.id));
    expect(creatorIds.size).toBe(seed.creators.length);
    expect(brandIds.size).toBe(seed.brands.length);
    expect(new Set(seed.deals.map((d) => d.id)).size).toBe(seed.deals.length);
    for (const d of seed.deals) {
      expect(brandIds.has(d.brand)).toBe(true);
      expect(creatorIds.has(d.creator)).toBe(true);
      expect(d.step).toBeGreaterThanOrEqual(0);
      expect(d.step).toBeLessThan(DEAL_FLOW.length);
    }
    expect(new Set(seed.notifications.map((n) => n.id)).size).toBe(seed.notifications.length);
  });

  it("is about AI creators and the brands that sponsor them", () => {
    expect(seed.brands.every((b) => b.sells.startsWith("AI "))).toBe(true);
    expect(seed.creators.map((c) => c.name)).toEqual([
      "Prompt Lab",
      "Neural Notes",
      "Code with Kai",
      "Tensor Talk",
      "The AI Desk",
      "Model Matters",
      "Prompt Daily",
      "Agent Weekly",
      "LLM Lowdown",
      "Token Tuesday",
      "Ship AI",
      "Diffusion Diaries",
      "Vector Vlog",
    ]);
  });

  it("seeds three example mailboxes, outreach2 nine days into its warm-up", () => {
    expect(seed.mailSettings.senderName).toBe("Moustafa");
    expect(seed.mailSettings.mailboxes).toEqual([
      { address: "outreach1@gratovo.example", dailyCap: 30, warmupStartedOn: null },
      {
        address: "outreach2@gratovo.example",
        dailyCap: 20,
        warmupStartedOn: new Date(now - 9 * 86_400_000).toISOString().slice(0, 10),
      },
      { address: "outreach3@gratovo.example", dailyCap: 30, warmupStartedOn: null },
    ]);
  });

  it("seeds Reach: three ready drafts (one with a claim gate) and the messages", () => {
    const stageOf = (id: string) => seed.creators.find((c) => c.id === id)?.stage;
    expect(seed.outreach.drafts.map((d) => [d.creator, d.state, stageOf(d.creator)])).toEqual([
      ["c6", "ready", "contact"],
      ["c13", "ready", "contact"],
      ["c7", "ready", "contact"],
    ]);
    const gated = seed.outreach.drafts.find((d) => d.creator === "c7")?.proposal;
    expect(gated?.status).toBe("needs_human");
    expect(gated?.gates).toEqual([
      {
        key: "g-claim",
        kind: "claim",
        text: "It says we worked with Lumen AI before. Confirm that is true.",
      },
    ]);
    // Five messages of the creators; the rest is outreach3's imported week (next test).
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    expect(
      seed.outreach.messages
        .filter((m) => creatorIds.has(m.creator))
        .map((m) => [m.creator, m.direction]),
    ).toEqual([
      ["c8", "out"],
      ["c9", "out"],
      ["c10", "out"],
      ["c9", "out"],
      ["c10", "in"],
    ]);
  });

  it("seeds outreach3 as slowed: over 3% bounced in a week, on channels no creator owns", () => {
    expect(seed.reachMailboxes).toEqual({
      "outreach3@gratovo.example": { paused: false, slowed: true },
    });
    const week = 7 * 86_400_000;
    const mine = (m: { mailbox: string | null }) => m.mailbox === "outreach3@gratovo.example";
    const messages = seed.outreach.messages;
    const sends = messages.filter(
      (m) => mine(m) && m.direction === "out" && m.at >= now - week && m.at <= now,
    );
    const bounces = messages.filter(
      (m) => mine(m) && m.direction === "in" && m.reading?.replyType === "any.bounce",
    );
    expect(sends.length).toBeGreaterThanOrEqual(10);
    expect(bounces.length).toBeGreaterThanOrEqual(1);
    expect(bounces.length / sends.length).toBeGreaterThan(0.03);
    // Nothing of it lands today, so today's count of sends is unchanged.
    expect(sends.every((m) => m.at <= now - 86_400_000)).toBe(true);
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    const history = messages.filter((m) => m.source === "imported");
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((m) => !creatorIds.has(m.creator))).toBe(true);
    expect(new Set(messages.map((m) => m.id)).size).toBe(messages.length);
    expect(new Set(messages.map((m) => m.gmailMessageId)).size).toBe(messages.length);
  });

  it("derives the frame's Reach from those rows", () => {
    const reach = exampleFrame(now).reach;
    expect(reach.drafts.map((d) => d.id)).toEqual(["dr3", "dr2", "dr1"]);
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    expect(
      reach.threads
        .filter((t) => creatorIds.has(t.creator))
        .map((t) => [t.creator, t.count, t.answered]),
    ).toEqual([
      ["c10", 2, false],
      ["c8", 1, true],
      ["c9", 2, true],
    ]);
    expect(reach.threads.find((t) => t.creator === "c10")?.lastIn?.preview).toBe("Hi Moustafa,");
    expect(reach).toMatchObject({ mailboxes: [], gemini: "off", sender: null });
    // Two sequences (D22), none due at load, so the stand-in drafter writes nothing by itself.
    expect(reach.sequences.map((q) => [q.creator, q.stopped, q.parkUntil])).toEqual([
      ["c9", null, null],
      ["c8", null, null],
    ]);
    expect(reach.sequences.find((q) => q.creator === "c9")?.steps.map((x) => x.state)).toEqual([
      "sent",
      "planned",
      "planned",
    ]);
    for (const q of reach.sequences) {
      expect(dueSteps(q, now)).toEqual([]);
      // The stage of its creator is emailed.
      expect(seed.creators.find((c) => c.id === q.creator)?.stage).toBe("emailed");
    }
  });
});

describe("exampleFrame", () => {
  const seed = exampleSeed(now);
  const frame = exampleFrame(now);

  it("is the seed as a fresh example source serves it", () => {
    expect(frame).toEqual({
      source: "example",
      me: "u1",
      myName: null,
      team: [
        {
          id: "u1",
          name: "",
          role: "full",
          roles: ["owner"],
          status: "online",
          doing: "Today",
        },
        {
          id: "u2",
          name: "Sara",
          role: "basic",
          roles: ["deal_lead", "delivery"],
          status: "online",
          doing: "Reach · replies",
        },
        {
          id: "u3",
          name: "Omar",
          role: "basic",
          roles: ["scout", "outreach"],
          status: "online",
          doing: "Search · keyword 12 of 40",
        },
        {
          id: "u4",
          name: "Lina",
          role: "basic",
          roles: ["scout"],
          status: "away",
          doing: "Away until 13:00",
        },
      ],
      counts: { today: 28, plannedMinutes: 90, find: 15, reach: 10, close: 6, deliver: 7 },
      notifications: seed.notifications,
      log: [],
      creators: seed.creators,
      brands: seed.brands,
      deals: seed.deals,
      mateRun: seed.mateRun(now),
      conflicts: [],
      notify: {},
      seesMoney: true,
      reach: { ...frame.reach, mailboxes: [], sender: null },
    });
  });

  it("shows every price to you, the Owner", () => {
    expect(frame.deals.every((d) => typeof d.price === "number")).toBe(true);
  });

  it("lists the notifications newest first", () => {
    const times = frame.notifications.map((n) => n.at);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("gives the same frame for the same `now`", () => {
    expect(exampleFrame(now)).toEqual(frame);
  });
});
