import type { CreatorKit, CreatorState, OutreachStore, ThreadMessage } from "@gratovo/core/data";
import { describe, expect, it } from "vitest";

import { channelId, creatorState } from "../find/catalog-fixture";
import { geminiParamsSchemas } from "../pipeline/gemini-protocol";

import { buildCommsFacts, threadIdOf, type FactsSource } from "./facts";

const sam = channelId("promptlab");
const kai = channelId("codewithkai");
const at = Date.UTC(2026, 9, 20, 9, 30);

function message(over: Partial<ThreadMessage>): ThreadMessage {
  return {
    id: "m1",
    direction: "out",
    kind: "first",
    followUp: null,
    subject: "your claude code test",
    body: "Hi Sam,\n\nYour test of Claude Code on a real app was clear.\n\nMoustafa",
    bodyCut: false,
    at,
    mailbox: "moustafa@gratovo.example",
    peer: "sam@promptlab.example",
    peerName: "Sam",
    by: "u1",
    source: "app",
    reading: null,
    ...over,
  };
}

/** The two reads the facts make; any other is a mistake. */
function source(
  states: readonly CreatorState[],
  messages: readonly ThreadMessage[],
  outbound: { creator: string; body: string }[],
): FactsSource & { asked: { thread: [string, number][]; recent: number[] } } {
  const asked = { thread: [] as [string, number][], recent: [] as number[] };
  const unused = (): never => {
    throw new Error("not read by the facts");
  };
  const outreach: OutreachStore = {
    reachParts: unused,
    draft: unused,
    draftsIn: unused,
    openDraft: unused,
    insertDraft: unused,
    updateDraft: unused,
    message: unused,
    storedGmailIds: unused,
    thread: (creator, limit) => {
      asked.thread.push([creator, limit]);
      return [...messages];
    },
    hasOutbound: unused,
    importMessages: unused,
    recentOutbound: (limit) => {
      asked.recent.push(limit);
      return outbound;
    },
    sentSince: unused,
    mailboxCounts: unused,
    sequence: unused,
    runningSequences: unused,
    commit: unused,
  };
  return { creatorStates: () => Promise.resolve(states), outreach, asked };
}

describe("the comms facts", () => {
  it("names the agency with the sender, the thread, the creator and the recent bodies", async () => {
    const src = source(
      [
        creatorState(sam, {
          stage: "contact",
          email: "sam@promptlab.example",
          emailConfirmed: true,
          legacyPipelineStage: "contacted",
        }),
        creatorState(kai, { stage: "contact" }),
      ],
      [
        message({ id: "m1" }),
        message({
          id: "m2",
          direction: "in",
          kind: null,
          subject: "Re: your claude code test",
          body: "Thanks! What do you have in mind?",
          at: at + 86_400_000,
          by: null,
          source: "sweep",
        }),
      ],
      [
        { creator: sam, body: "Hi Sam, your Claude Code test was clear." },
        { creator: kai, body: "Hi Kai, your Cursor walk-through was clear." },
      ],
    );

    const facts = await buildCommsFacts({
      source: src,
      creatorId: sam,
      sender: "Moustafa",
      now: at,
    });

    expect(facts).toEqual({
      agency: {
        name: "Gratovo",
        sender: "Moustafa",
        whatWeDo: null,
        website: null,
        trueClaims: [],
        pastCampaigns: [],
        incubator: true,
        boycott: { countries: ["IL"], brands: [] },
      },
      thread: {
        id: `c:${sam}`,
        channelId: sam,
        brandId: null,
        contactEmail: "sam@promptlab.example",
        dealId: null,
        messages: [
          {
            direction: "outbound",
            subject: "your claude code test",
            body: "Hi Sam,\n\nYour test of Claude Code on a real app was clear.\n\nMoustafa",
            at: "2026-10-20T09:30:00.000Z",
          },
          {
            direction: "inbound",
            subject: "Re: your claude code test",
            body: "Thanks! What do you have in mind?",
            at: "2026-10-21T09:30:00.000Z",
          },
        ],
      },
      creators: { [sam]: { pipelineStage: "contacted", mediaKit: null, creatorGender: null } },
      brand: null,
      deal: null,
      recentOutbound: [
        { threadId: `c:${sam}`, body: "Hi Sam, your Claude Code test was clear." },
        { threadId: `c:${kai}`, body: "Hi Kai, your Cursor walk-through was clear." },
      ],
    });
    expect(src.asked).toEqual({ thread: [[sam, 500]], recent: [20] });
    expect(
      geminiParamsSchemas["action.comms_propose"].safeParse({
        request: { kind: "first", channelId: sam, threadId: threadIdOf(sam) },
        facts,
      }).success,
    ).toBe(true);
  });

  it("cuts long bodies to 100,000 characters, and leaves out what it doesn't know", async () => {
    const long = "a".repeat(100_050);
    const src = source([], [message({ body: long })], [{ creator: kai, body: long }]);

    const facts = await buildCommsFacts({ source: src, creatorId: sam, sender: null, now: at });

    expect(facts.agency?.sender).toBeNull();
    expect(facts.thread?.contactEmail).toBeNull();
    expect(facts.thread?.messages[0]?.body).toHaveLength(100_000);
    expect(facts.recentOutbound[0]?.body).toHaveLength(100_000);
    expect(facts.creators).toEqual({});
    expect(
      geminiParamsSchemas["action.comms_propose"].safeParse({
        request: { kind: "first", channelId: sam },
        facts,
      }).success,
    ).toBe(true);
  });

  it("sends no stage for a creator without a legacy one", async () => {
    const src = source([creatorState(sam, { legacyPipelineStage: "" })], [], []);
    const facts = await buildCommsFacts({
      source: src,
      creatorId: sam,
      sender: "Moustafa",
      now: at,
    });
    expect(facts.creators[sam]).toEqual({
      pipelineStage: null,
      mediaKit: null,
      creatorGender: null,
    });
    expect(facts.thread?.messages).toEqual([]);
  });

  const kit: CreatorKit = {
    countries: [
      { code: "US", share: 40 },
      { code: "GB", share: 12 },
    ],
    ageBand: "18-34",
    engagement: 4.2,
    rate: 900,
    rateKnown: true,
    link: null,
    fromReply: false,
  };

  it("gives the engine the kit, with the rate agreed once the creator is signed", async () => {
    const signed = await buildCommsFacts({
      source: source([creatorState(sam, { stage: "signed" })], [], []),
      creatorId: sam,
      sender: null,
      now: at,
      kit,
    });
    expect(signed.creators[sam]?.mediaKit).toEqual({
      countries: [
        { code: "US", pct: 40 },
        { code: "GB", pct: 12 },
      ],
      ageBand: "18-34",
      engagement: 4.2,
      link: null,
      rates: [{ format: "integration", price: 900, agreed: true }],
    });
    expect(
      geminiParamsSchemas["action.comms_propose"].safeParse({
        request: { kind: "reply", channelId: sam, goal: "ask_kit", missing: ["age", "rate"] },
        facts: signed,
      }).success,
    ).toBe(true);
  });

  it("leaves the rate unagreed before signing, and sends no kit when none is given", async () => {
    const kitStage = await buildCommsFacts({
      source: source([creatorState(sam, { stage: "kit" })], [], []),
      creatorId: sam,
      sender: null,
      now: at,
      kit,
    });
    expect(kitStage.creators[sam]?.mediaKit).toMatchObject({
      rates: [{ format: "integration", price: 900, agreed: false }],
    });
    const none = await buildCommsFacts({
      source: source([creatorState(sam, { stage: "kit" })], [], []),
      creatorId: sam,
      sender: null,
      now: at,
    });
    expect(none.creators[sam]?.mediaKit).toBeNull();
  });

  it("refuses a goal that does not exist, or a repeated missing item", () => {
    const parse = (request: object) =>
      geminiParamsSchemas["action.comms_propose"].safeParse({
        request,
        facts: {
          agency: null,
          thread: null,
          creators: {},
          brand: null,
          deal: null,
          recentOutbound: [],
        },
      }).success;
    expect(parse({ kind: "reply", goal: "sell" })).toBe(false);
    expect(parse({ kind: "reply", goal: "ask_kit", missing: ["age", "age"] })).toBe(false);
    expect(parse({ kind: "reply", goal: "decline_audience" })).toBe(true);
  });
});
