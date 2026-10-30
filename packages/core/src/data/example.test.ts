import { describe, expect, it } from "vitest";

import { DEAL_FLOW } from "../deal-flow";
import { seesMoney } from "./access";
import { dueSteps } from "../reach/sequence";
import { checkAudience, kitView } from "../close/audience";
import { exampleFrame, exampleSeed, exampleSeedVersion, scenarios } from "./example";
import { exampleChannelId } from "./example-roster";
import { agencyRoles, creatorStages, notificationIcons } from "./types";
import { brandStatuses, contractClauses, qcChecks } from "./work-types";

/** A creator's id from its short key ("c1"). */
const id = exampleChannelId;

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
    // The creators the seed always had keep their names and their order; v6's come after.
    expect(seed.creators.slice(0, 16).map((c) => c.name)).toEqual([
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
      "AgentWorks",
      "Silicon Sage",
      "Context Window",
    ]);
    const names = seed.creators.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(seed.creators.map((c) => c.handle)).size).toBe(names.length);
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
      [id("c6"), "ready", "contact"],
      [id("c13"), "ready", "contact"],
      [id("c7"), "ready", "contact"],
      [id("c27"), "ready", "contact"],
      [id("c28"), "ready", "contact"],
      [id("c18"), "ready", "replied"],
      [id("c20"), "ready", "replied"],
    ]);
    const gated = seed.outreach.drafts.find((d) => d.creator === id("c7"))?.proposal;
    expect(gated?.status).toBe("needs_human");
    expect(gated?.gates).toEqual([
      {
        key: "g-claim",
        kind: "claim",
        text: "It says we worked with Lumen AI before. Confirm that is true.",
      },
    ]);
    // The creators' messages; the rest is outreach3's imported week (next test).
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    expect(
      seed.outreach.messages
        .filter((m) => creatorIds.has(m.creator))
        .map((m) => [m.creator, m.direction]),
    ).toEqual([
      [id("c8"), "out"],
      [id("c9"), "out"],
      [id("c10"), "out"],
      [id("c9"), "out"],
      [id("c14"), "out"],
      [id("c14"), "in"],
      [id("c14"), "out"],
      [id("c15"), "out"],
      [id("c15"), "in"],
      [id("c15"), "out"],
      [id("c16"), "out"],
      [id("c16"), "in"],
      [id("c16"), "out"],
      [id("c45"), "out"],
      [id("c45"), "in"],
      [id("c45"), "out"],
      [id("c10"), "in"],
      ...[
        ["c21", "out"],
        ["c22", "out"],
        ["c22", "out"],
        ["c23", "out"],
        ["c24", "out"],
        ["c24", "out"],
        ["c24", "out"],
        ["c25", "out"],
        ["c26", "out"],
        ["c18", "out"],
        ["c18", "in"],
        ["c19", "out"],
        ["c19", "in"],
        ["c19", "out"],
        ["c20", "out"],
        ["c20", "in"],
        ["c46", "out"],
        ["c46", "in"],
        ["c46", "out"],
      ].map(([key, direction]) => [id(key ?? ""), direction]),
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

  it("gives Vector Vlog's reply a reading with a rate, countries and an age band (6d)", () => {
    const reply = seed.outreach.messages.find((m) => m.id === "msg4");
    expect(reply).toMatchObject({ creator: id("c10"), direction: "in" });
    // The facts are the ones the reply's own words give, none saved yet.
    expect(reply?.reading).toMatchObject({
      replyType: "inf.gives_rate",
      label: "Gives their rate or rate card",
      side: "influencer",
      corrected: false,
    });
    expect(reply?.reading?.facts).toEqual([
      { key: "rate", rate: 1200, saved: false },
      {
        key: "countries",
        countries: [
          { code: "US", share: null },
          { code: "GB", share: null },
        ],
        saved: false,
      },
      { key: "age", band: "25-34", saved: false },
    ]);
    expect(
      exampleFrame(now).reach.threads.find((t) => t.creator === id("c10"))?.lastIn?.reading,
    ).toEqual(reply?.reading);
    // The stage stays replied and no answer draft is seeded.
    expect(seed.creators.find((c) => c.id === id("c10"))?.stage).toBe("replied");
    expect(seed.outreach.drafts.some((d) => d.creator === id("c10"))).toBe(false);
  });

  it("derives the frame's Reach from those rows", () => {
    const reach = exampleFrame(now).reach;
    expect(reach.drafts.map((d) => d.id)).toEqual([
      "dr7",
      "dr3",
      "dr5",
      "dr2",
      "dr4",
      "dr1",
      "dr6",
    ]);
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    expect(
      Object.fromEntries(
        reach.threads
          .filter((t) => creatorIds.has(t.creator))
          .map((t) => [t.creator, [t.count, t.answered]]),
      ),
    ).toEqual(
      Object.fromEntries(
        (
          [
            ["c10", 2, false],
            ["c14", 3, true],
            ["c15", 3, true],
            ["c16", 3, true],
            ["c45", 3, true],
            ["c8", 1, true],
            ["c9", 2, true],
            ["c21", 1, true],
            ["c22", 2, true],
            ["c23", 1, true],
            ["c24", 3, true],
            ["c25", 1, true],
            ["c26", 1, true],
            ["c18", 2, false],
            ["c19", 3, true],
            ["c20", 2, false],
            ["c46", 3, true],
          ] as const
        ).map(([key, count, answered]) => [id(key), [count, answered]]),
      ),
    );
    expect(reach.threads.find((t) => t.creator === id("c10"))?.lastIn?.preview).toBe(
      "Hi Moustafa,",
    );
    expect(reach).toMatchObject({ mailboxes: [], gemini: "off", sender: null });
    // A sequence for each creator who was emailed (D22), none due at load, so the stand-in
    // drafter writes nothing by itself.
    const state = (key: string): [string | null, boolean] => {
      const q = reach.sequences.find((x) => x.creator === id(key));
      return [q?.stopped ?? null, q?.parkUntil != null];
    };
    expect(reach.sequences).toHaveLength(12);
    for (const key of ["c8", "c9", "c21", "c22", "c23", "c24", "c25", "c26"]) {
      expect(state(key)).toEqual([null, false]);
    }
    expect(state("c18")).toEqual(["replied", false]);
    expect(state("c20")).toEqual(["replied", false]);
    expect(state("c19")).toEqual([null, true]);
    expect(state("c46")).toEqual([null, true]);
    expect(reach.sequences.find((q) => q.creator === id("c9"))?.steps.map((x) => x.state)).toEqual([
      "sent",
      "planned",
      "planned",
    ]);
    for (const q of reach.sequences) {
      expect(dueSteps(q, now)).toEqual([]);
      const stage = seed.creators.find((c) => c.id === q.creator)?.stage;
      // A running sequence belongs to an emailed creator; a stopped or parked one to a creator
      // who answered.
      expect(stage).toBe(
        q.stopped === null && q.parkUntil === null
          ? "emailed"
          : q.creator === id("c46")
            ? "parked"
            : "replied",
      );
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

  it("seeds kit-stage creators that pass, fail and rely on a reply, and typed kits for the signed", () => {
    const seed = exampleSeed(now);
    const kitOf = (creatorId: string) => {
      const stored = seed.kits[creatorId];
      return kitView(
        stored?.mediaKit ?? null,
        stored?.provided ?? null,
        stored?.engagement ?? null,
      );
    };
    const verdictOf = (creatorId: string) => {
      const kit = kitOf(creatorId);
      return kit === null ? null : checkAudience(kit).verdict;
    };
    const kitStage = seed.creators.filter((c) => c.stage === "kit").map((c) => c.id);
    const verdicts = kitStage.map(verdictOf);
    expect(verdicts).toContain("pass");
    expect(verdicts).toContain("fail");
    expect(verdicts).toContain("missing");
    expect(kitOf(id("c16"))?.fromReply).toBe(true);
    for (const signedId of seed.creators.filter((c) => c.stage === "signed").map((c) => c.id)) {
      expect(kitOf(signedId)?.rate).toBeGreaterThan(0);
    }
    // Each kit-stage creator has an inbound message for a decline or an ask to answer.
    for (const kitId of kitStage) {
      expect(seed.outreach.messages.some((m) => m.creator === kitId && m.direction === "in")).toBe(
        true,
      );
    }
  });
});

describe("exampleSeed scenarios", () => {
  const week = 7 * 24 * 3600 * 1000;

  it("lists the four scenarios", () => {
    expect([...scenarios]).toEqual(["normal", "first", "later", "broke"]);
  });

  it("normal is the default seed, with nothing broken", () => {
    const normal = exampleSeed(now, "normal");
    const plain = exampleSeed(now);
    expect({ ...normal, mateRun: null }).toEqual({ ...plain, mateRun: null });
    expect(normal.mateRun(now)).toEqual(plain.mateRun(now));
    expect(normal.health).toBeNull();
  });

  it("later is the normal seed a week older", () => {
    const normal = exampleSeed(now);
    const later = exampleSeed(now, "later");
    expect(later.health).toBeNull();
    expect(later.notifications[0]?.at).toBe((normal.notifications[0]?.at ?? 0) - week);
    expect(later.outreach.drafts[0]?.at).toBe((normal.outreach.drafts[0]?.at ?? 0) - week);
    // The roster moves with it: the same creators, found a week earlier.
    expect(later.creators.map((c) => c.id)).toEqual(normal.creators.map((c) => c.id));
    expect(later.channels[0]?.foundAt).toBe((normal.channels[0]?.foundAt ?? 0) - week);
    expect(later.deals[0]?.createdAt).toBe((normal.deals[0]?.createdAt ?? 0) - week);
  });

  it("first has only you and one new mailbox", () => {
    const first = exampleSeed(now, "first");
    expect(first.channels).toEqual([]);
    expect(first.profiles.map((p) => p.id)).toEqual(["u1"]);
    expect(first.access.map((a) => a.profileId)).toEqual(["u1"]);
    expect(Object.keys(first.presence)).toEqual(["u1"]);
    expect(first.creators).toEqual([]);
    expect(first.brands).toEqual([]);
    expect(first.deals).toEqual([]);
    expect(first.notifications).toEqual([]);
    expect(first.outreach).toEqual({ drafts: [], messages: [], sequences: [] });
    expect(Object.values(first.counts)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(first.mailSettings.mailboxes).toEqual([
      { address: "outreach1@gratovo.example", dailyCap: 10, warmupStartedOn: "2026-10-20" },
    ]);
    expect(first.reachMailboxes).toEqual({});
    expect(first.health).toBeNull();
  });

  it("broke signs a mailbox out, silences Gemini and puts three alerts first", () => {
    const normal = exampleSeed(now);
    const broke = exampleSeed(now, "broke");
    expect(broke.health).toEqual({
      signedOut: ["outreach1@gratovo.example"],
      geminiOffline: true,
    });
    const alerts = broke.notifications.slice(0, 3);
    expect(alerts.map((n) => n.at)).toEqual([on(0, 9, 40), on(0, 8, 52), on(-1, 18, 5)]);
    expect(alerts.map((n) => n.go)).toEqual([
      { screen: "find", tab: "search" },
      { screen: "settings", tab: "connections" },
      { screen: "reach", tab: "mailboxes" },
    ]);
    expect(alerts[2]?.text).toBe("outreach1 is signed out of Gmail");
    expect(alerts.every((n) => n.icon === "alert" && !n.read)).toBe(true);
    expect(broke.notifications.slice(3)).toEqual(normal.notifications);
    const ids = broke.notifications.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the full roster (plan step P1-3)", () => {
  const seed = exampleSeed(now);
  const idPattern = /^UC[A-Za-z0-9_-]{22}$/;

  it("is v6's size, with creators in every stage", () => {
    expect(seed.creators.length).toBeGreaterThanOrEqual(35);
    const stages = new Set(seed.creators.map((c) => c.stage));
    expect([...stages].sort()).toEqual([...creatorStages].sort());
  });

  it("makes creator ids in the pipeline's shape, the same every time", () => {
    for (const c of seed.creators) {
      expect(c.id).toMatch(idPattern);
    }
    expect(id("c1")).toBe(id("c1"));
    expect(exampleSeed(now + 5000).creators.map((c) => c.id)).toEqual(
      seed.creators.map((c) => c.id),
    );
    expect(new Set(seed.creators.map((c) => c.id)).size).toBe(seed.creators.length);
  });

  it("gives every creator details: an owner, a format, a bot risk and socials", () => {
    const members = new Set(seed.profiles.map((p) => p.id));
    for (const c of seed.creators) {
      expect(c.details, c.name).toBeDefined();
      expect(members.has(c.details?.owner ?? "")).toBe(true);
      expect(c.details?.format).not.toBeNull();
      expect(c.details?.botRisk?.note).toEqual(expect.any(String));
      expect(Object.keys(c.details?.socials ?? {}).length).toBeGreaterThan(0);
    }
    const formats = new Set(seed.creators.map((c) => c.details?.format));
    expect(formats).toEqual(new Set(["talking_head", "long_form", "shorts"]));
    const levels = new Set(seed.creators.map((c) => c.details?.botRisk?.level));
    expect(levels).toEqual(new Set(["clean", "high"]));
  });

  it("gives every signed creator a relationship, an open slot and onboarding", () => {
    const signed = seed.creators.filter((c) => c.stage === "signed");
    expect(signed.length).toBeGreaterThanOrEqual(6);
    for (const c of signed) {
      expect(c.details?.relationship, c.name).not.toBeNull();
      expect(c.details?.lastUpdateAt ?? now + 1).toBeLessThanOrEqual(now);
      expect(c.details?.nextOpenSlot ?? 0).toBeGreaterThan(now);
      expect(c.details?.onboarding?.dreamBrands.length).toBeGreaterThan(0);
      expect(c.details?.onboarding?.paymentRail).not.toBeNull();
      expect(c.details?.onboarding?.taxForm).not.toBeNull();
    }
    const locked = signed.flatMap((c) => c.details?.locks ?? []);
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((l) => l.until > now)).toBe(true);
    // Nobody else has a relationship.
    for (const c of seed.creators.filter((x) => x.stage !== "signed")) {
      expect(c.details?.relationship).toBeNull();
    }
  });

  it("has a channel for every creator, with 6 to 12 videos that fit its median", () => {
    expect(seed.channels.map((c) => c.id)).toEqual(seed.creators.map((c) => c.id));
    for (const channel of seed.channels) {
      expect(channel.videos.length).toBeGreaterThanOrEqual(6);
      expect(channel.videos.length).toBeLessThanOrEqual(12);
      const views = channel.videos.map((v) => v.views).sort((a, b) => a - b);
      const median = views[Math.floor(views.length / 2)] ?? 0;
      expect(median).toBeGreaterThan(channel.medianViews * 0.6);
      expect(median).toBeLessThan(channel.medianViews * 1.5);
      const times = channel.videos.map((v) => v.publishedAt);
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(times[0]).toBeLessThanOrEqual(now);
      expect(channel.latestUploadAt).toBe(times[0]);
      expect(new Set(channel.videos.map((v) => v.title)).size).toBe(channel.videos.length);
      expect(channel.foundAt).toBeLessThanOrEqual(now);
    }
  });

  it("has ten brands in every lane but lost, every field filled", () => {
    expect(seed.brands).toHaveLength(10);
    const statuses = new Set(seed.brands.map((b) => b.status));
    expect([...statuses].sort()).toEqual(brandStatuses.filter((s) => s !== "lost").sort());
    expect(seed.brands.slice(0, 5).map((b) => [b.id, b.name])).toEqual([
      ["b1", "Codewell"],
      ["b2", "Lumen AI"],
      ["b3", "VoxCraft"],
      ["b4", "Pagewise"],
      ["b5", "Clipforge"],
    ]);
    const members = new Set(seed.profiles.map((p) => p.id));
    for (const b of seed.brands) {
      expect(b.category, b.name).not.toBeNull();
      expect(b.country).not.toBeNull();
      expect(b.site).not.toBeNull();
      expect(b.headcount).not.toBeNull();
      expect(b.recommendedTitle).not.toBeNull();
      expect(b.paidSpenderVerified).not.toBeNull();
      expect(b.pastCampaignHook).not.toBeNull();
      expect(b.since).not.toBeNull();
      expect(members.has(b.owner ?? "")).toBe(true);
      expect(b.budgetKnown).toBe(b.budget !== null);
      if (b.budget !== null) expect(b.budget.high).toBeGreaterThanOrEqual(b.budget.low);
    }
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    for (const b of seed.brands) {
      expect(b.seen.every((x) => creatorIds.has(x))).toBe(true);
      expect(b.pitched?.creators.every((x) => creatorIds.has(x)) ?? true).toBe(true);
    }
    expect(seed.brands.some((b) => b.pitched !== null)).toBe(true);
    expect(seed.brands.some((b) => b.contacts.length === 2)).toBe(true);
  });

  it("has eight deals spread over the steps, each checklist as long as its step's", () => {
    expect(seed.deals).toHaveLength(8);
    expect(seed.deals.slice(0, 5).map((d) => [d.id, d.brand, d.step, d.price])).toEqual([
      ["d1", "b1", 1, 4800],
      ["d2", "b2", 3, 2600],
      ["d3", "b3", 6, 3400],
      ["d4", "b4", 7, 2200],
      ["d5", "b5", 0, 5200],
    ]);
    expect(new Set(seed.deals.map((d) => d.step)).size).toBeGreaterThanOrEqual(7);
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    const brandIds = new Set(seed.brands.map((b) => b.id));
    for (const d of seed.deals) {
      expect(d.checks, d.id).toHaveLength(DEAL_FLOW[d.step]?.items.length ?? -1);
      expect(d.clauses).toHaveLength(contractClauses.length);
      expect(d.qc).toHaveLength(qcChecks.length);
      expect(brandIds.has(d.brand)).toBe(true);
      expect(creatorIds.has(d.creator)).toBe(true);
      expect(d.createdAt).not.toBeNull();
      expect(d.price ?? 0).toBeGreaterThan(0);
      expect(d.payout ?? 0).toBeGreaterThan(0);
      expect(d.model).not.toBeNull();
      expect(d.invoice.number === null).toBe(d.id === "d5");
    }
    // The price-per-view deal is the one still being negotiated.
    expect(seed.deals.filter((d) => d.cpm !== null).map((d) => d.id)).toEqual(["d5"]);
    expect(seed.deals.find((d) => d.id === "d5")?.negotiation?.history).toHaveLength(2);
    expect(seed.deals.filter((d) => d.report !== null).map((d) => d.report?.verdict)).toEqual([
      "over",
      "under",
      "over",
    ]);
  });

  it("keeps the v6 rule codes out of every word of the seed", () => {
    const codes = /\b(?:HC|INF|BRD|FND|EX)-[A-Z]*-?\d+/;
    const found: string[] = [];
    const scan = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        if (codes.test(value)) found.push(`${path}: ${value}`);
      } else if (Array.isArray(value)) {
        value.forEach((item, i) => {
          scan(item, `${path}[${String(i)}]`);
        });
      } else if (typeof value === "object" && value !== null) {
        for (const [key, item] of Object.entries(value)) scan(item, `${path}.${key}`);
      }
    };
    for (const scenario of scenarios) {
      scan(exampleSeed(now, scenario), scenario);
    }
    expect(found).toEqual([]);
  });

  it("keeps every cross-reference in the reach rows pointing at a creator", () => {
    const creatorIds = new Set(seed.creators.map((c) => c.id));
    for (const m of seed.outreach.messages.filter((x) => x.source !== "imported")) {
      expect(creatorIds.has(m.creator), m.id).toBe(true);
    }
    for (const dr of seed.outreach.drafts) expect(creatorIds.has(dr.creator)).toBe(true);
    for (const q of seed.outreach.sequences) expect(creatorIds.has(q.creator)).toBe(true);
    for (const key of Object.keys(seed.kits)) expect(creatorIds.has(key)).toBe(true);
    const messageIds = new Set(seed.outreach.messages.map((m) => m.id));
    for (const dr of seed.outreach.drafts.filter((x) => x.replyTo !== null)) {
      expect(messageIds.has(dr.replyTo ?? "")).toBe(true);
    }
  });
});
