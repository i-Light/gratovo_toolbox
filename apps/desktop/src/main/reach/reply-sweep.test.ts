import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  exampleChannelId as ch,
  type DataSource,
  type DraftProposal,
  type DraftState,
  type StoredDraft,
} from "@gratovo/core/data";
import type { ChannelResponse, FramePart } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contractNow } from "../data/data-source-contract";
import { openExampleSource } from "../data/example-source";
import type { JobOutcome } from "../pipeline/jobs";
import type { ReplyMessage, Start } from "../pipeline/protocol";

import {
  createReplySweep,
  firstSweepMs,
  sweepEveryMs,
  type ReplySweep,
  type ReplySweepDeps,
} from "./reply-sweep";
import type { Situation, Situations } from "./situations";

/**
 * The reply sweep, Paste a reply, the reading and "That's not it" (plan step 6d, D23), on the real
 * example data in a temp file with a fake quick lane. No test here reads a real mailbox; the lane's
 * `mail.replies` answers are made up, and `mail.send` is never asked for.
 */

const hour = 3_600_000;
const noDraft = "no draft";
const everyState: readonly DraftState[] = [
  "drafting",
  "ready",
  "failed",
  "approved",
  "scheduled",
  "sending",
  "sent",
  "skipped",
];

const situationList: readonly Situation[] = [
  {
    id: "inf.interested_vague",
    label: "Interested / 'what do you have in mind?'",
    side: "influencer",
  },
  { id: "inf.gives_rate", label: "Gives their rate or rate card", side: "influencer" },
  { id: "inf.not_interested", label: "Not interested / no partnerships", side: "influencer" },
  { id: "brd.yes", label: "Says yes / wants to proceed", side: "brand" },
  { id: "any.out_of_office", label: "Out-of-office / auto-reply", side: "any" },
  { id: "any.bounce", label: "Bounce / address does not exist", side: "any" },
];

const situations: Situations = {
  list: () => Promise.resolve(situationList),
  labelOf: (id) => Promise.resolve(situationList.find((s) => s.id === id)?.label ?? null),
};

let folder: string;
let real: DataSource;
let open: DataSource | null;
let clock: number;
let timers: { ms: number; run: () => void }[];
let jobs: Start["job"][];
let lines: string[];
let changed: ReturnType<typeof vi.fn<(more?: readonly FramePart[]) => void>>;
let kicked: number;
let afterWrites: number;
let rereads: { draftId: string; label: string }[];
let rereadAnswer: ChannelResponse<"reach:rewrite">;
let tokens: string[];
let replies: ReplyMessage[];
let ackAnswer: "done" | "failed";
let repliesAnswer: "done" | "failed" | "not_connected";
let sweep: ReplySweep;
let ids: number;
let mode: "example" | "live" | null;

/** One reply line as `mail.replies` writes it. */
function reply(over: Partial<ReplyMessage> = {}): ReplyMessage {
  return {
    type: "reply",
    account: "outreach1@gratovo.example",
    conversationKey: `c:${ch("c8")}`,
    channelId: ch("c8"),
    messageId: "gm-r1",
    from: "team@shipai.dev",
    fromName: "Mia",
    subject: "Re: Your video on shipping AI features",
    body: "Hi, thanks for writing. I would like to hear more.",
    bodyCut: false,
    receivedAt: new Date(contractNow - hour).toISOString(),
    isFirstReply: true,
    cancelledFollowUps: 0,
    ...over,
  };
}

/** The fake quick lane: `mail.replies` answers `replies`, `mail.ack` is recorded. */
function lane(job: Start["job"]): Promise<JobOutcome | null> {
  jobs.push(job);
  if (job.kind === "mail.replies") {
    if (repliesAnswer === "failed") {
      return Promise.resolve({ ok: false, problem: "no_python" });
    }
    if (repliesAnswer === "not_connected") {
      return Promise.resolve({
        ok: true,
        replies: [],
        exit: {
          kind: "ended",
          end: { type: "end", state: "failed", error: { code: "mail_not_connected" } },
          result: null,
        },
      } as unknown as JobOutcome);
    }
    return Promise.resolve({
      ok: true,
      replies,
      exit: {
        kind: "ended",
        end: { type: "end", state: "done" },
        result: {
          type: "result",
          kind: "mail.replies",
          data: {
            accounts: [
              {
                account: "outreach1@gratovo.example",
                checked: 3,
                replies: replies.length,
                cancelledQueued: 0,
                error: null,
              },
            ],
          },
        },
      },
    } as unknown as JobOutcome);
  }
  if (job.kind === "mail.ack") {
    return Promise.resolve({
      ok: true,
      replies: [],
      exit: {
        kind: "ended",
        end: { type: "end", state: ackAnswer === "done" ? "done" : "failed" },
        result: { type: "result", kind: "mail.ack", data: { acknowledged: job.messageIds.length } },
      },
    } as unknown as JobOutcome);
  }
  return Promise.resolve(null);
}

function make(over: Partial<ReplySweepDeps> = {}): ReplySweep {
  return createReplySweep({
    mode: () => mode,
    source: () => open,
    run: lane,
    connected: () => Promise.resolve(tokens),
    situations,
    reread: (draftId, label) => {
      rereads.push({ draftId, label });
      return Promise.resolve(rereadAnswer);
    },
    changed,
    kick: () => {
      kicked += 1;
    },
    afterWrite: () => {
      afterWrites += 1;
    },
    now: () => clock,
    setTimer: (run, ms) => {
      const entry = { ms, run };
      timers.push(entry);
      return entry;
    },
    clearTimer: (handle) => {
      timers = timers.filter((t) => t !== handle);
    },
    log: (line) => lines.push(line),
    newId: () => `id-${String(++ids)}`,
    ...over,
  });
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-replies-"));
  clock = contractNow;
  timers = [];
  jobs = [];
  lines = [];
  changed = vi.fn<(more?: readonly FramePart[]) => void>();
  kicked = 0;
  afterWrites = 0;
  rereads = [];
  rereadAnswer = { ok: true };
  tokens = ["outreach1@gratovo.example"];
  replies = [];
  ackAnswer = "done";
  repliesAnswer = "done";
  ids = 0;
  mode = "live";
  real = openExampleSource(join(folder, "example.db"), () => clock);
  open = real;
  sweep = make();
});

afterEach(async () => {
  sweep.stop();
  real.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const states = async () => await real.creatorStates();
const creator = async (id: string) => (await states()).find((c) => c.id === id);
const acked = (): string[] =>
  jobs.flatMap((job) => (job.kind === "mail.ack" ? job.messageIds : []));
const drafts = (): StoredDraft[] => real.outreach.draftsIn(everyState);
const answers = (id: string): StoredDraft[] =>
  drafts().filter((d) => d.creator === id && d.kind === "reply");

/** A follow-up draft waiting for the person at a creator whose first email went out. */
function followUp(id: string, state: DraftState = "ready"): void {
  real.outreach.insertDraft({
    id: `fu-${id}`,
    creator: id,
    kind: "followUp",
    followUp: 1,
    mailbox: "outreach1@gratovo.example",
    replyTo: null,
    at: clock,
  });
  real.outreach.updateDraft(`fu-${id}`, { state, subject: "S", body: "B" }, clock);
  const sequence = real.outreach.sequence(id);
  if (sequence !== null) {
    real.outreach.commit({
      at: clock,
      sequences: [
        {
          ...sequence,
          steps: sequence.steps.map((s) => (s.n === 1 ? { ...s, state: "drafted" } : s)),
        },
      ],
    });
  }
}

describe("check: the answers", () => {
  it("answers no_data with no source, example with example data, and no_mail with no connected mailbox", async () => {
    open = null;
    expect(await sweep.check()).toEqual({ ok: false, problem: "no_data" });
    open = real;
    mode = "example";
    expect(await sweep.check()).toEqual({ ok: false, problem: "example" });
    mode = "live";
    tokens = [];
    expect(await sweep.check()).toEqual({ ok: false, problem: "no_mail" });
    // A token for an address that is not one of the mailboxes is not a mailbox.
    tokens = ["someone-else@gratovo.example"];
    expect(await sweep.check()).toEqual({ ok: false, problem: "no_mail" });
    expect(jobs).toEqual([]);
  });

  it("matches the connected address whatever its case", async () => {
    tokens = ["OUTREACH1@Gratovo.Example"];
    expect(await sweep.check()).toEqual({ ok: true, stored: 0 });
    expect(jobs).toEqual([{ kind: "mail.replies" }]);
  });

  it("answers failed when the job can't run or ends badly, and no_mail when Gmail isn't connected", async () => {
    repliesAnswer = "failed";
    expect(await sweep.check()).toEqual({ ok: false, problem: "failed" });
    repliesAnswer = "not_connected";
    expect(await sweep.check()).toEqual({ ok: false, problem: "no_mail" });
    expect(acked()).toEqual([]);
    // The reason is a code, never anything else.
    expect(lines.join("\n")).toContain("no_python");
    expect(lines.join("\n")).toContain("mail_not_connected");
  });

  it("answers busy while a sweep is running, and runs one sweep at a time", async () => {
    let release: (outcome: JobOutcome | null) => void = () => undefined;
    let hold = true;
    const slow = make({
      run: (job) => {
        if (!hold) {
          return lane(job);
        }
        jobs.push(job);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    const first = slow.check();
    await vi.waitFor(() => {
      expect(jobs).toHaveLength(1);
    });
    expect(await slow.check()).toEqual({ ok: false, problem: "busy" });
    hold = false;
    release(null);
    expect(await first).toEqual({ ok: false, problem: "no_data" });
    // Done: the next one runs.
    expect(await slow.check()).not.toEqual({ ok: false, problem: "busy" });
  });

  it("stores nothing and acknowledges nothing when the data switched under the sweep", async () => {
    replies = [reply()];
    const switching = make({
      run: async (job) => {
        const outcome = await lane(job);
        open = null;
        return outcome;
      },
    });
    expect(await switching.check()).toEqual({ ok: false, problem: "no_data" });
    expect(acked()).toEqual([]);
    expect(real.outreach.storedGmailIds(["gm-r1"]).size).toBe(0);
  });
});

describe("the sweep stores a reply and what it brings", () => {
  it("stores the reply as an in message, then acknowledges exactly its id", async () => {
    replies = [reply({ bodyCut: true })];
    expect(await sweep.check()).toEqual({ ok: true, stored: 1 });
    const message = real.outreach.thread(ch("c8"), 10).find((m) => m.direction === "in");
    expect(message).toMatchObject({
      direction: "in",
      source: "sweep",
      mailbox: "outreach1@gratovo.example",
      peer: "team@shipai.dev",
      peerName: "Mia",
      subject: "Re: Your video on shipping AI features",
      body: "Hi, thanks for writing. I would like to hear more.",
      bodyCut: true,
      at: contractNow - hour,
      reading: null,
      by: null,
    });
    expect(acked()).toEqual(["gm-r1"]);
    // The ack came after the store: the job order is replies, then ack.
    expect(jobs.map((j) => j.kind)).toEqual(["mail.replies", "mail.ack"]);
  });

  it("moves the stage, stops the sequence, skips the follow-up, tells and logs, and queues an answer", async () => {
    followUp(ch("c8"));
    replies = [reply()];
    await sweep.check();
    expect((await creator(ch("c8")))?.stage).toBe("replied");
    expect(real.outreach.sequence(ch("c8"))).toMatchObject({
      stopped: "replied",
      // The drafted step goes back to planned: its draft is skipped.
      steps: [{ n: 1, state: "planned" }, { n: 2 }, { n: 3 }],
    });
    expect(real.outreach.draft(`fu-${ch("c8")}`)).toMatchObject({
      state: "skipped",
      problem: null,
    });
    const frame = await real.frame();
    expect(frame.notifications.find((n) => n.id.startsWith("reply-"))).toMatchObject({
      icon: "reply",
      text: "Ship AI replied",
      sub: "Re: Your video on shipping AI features",
      go: { screen: "reach", tab: "inbox" },
      read: false,
    });
    expect(frame.log.find((l) => l.text === "Ship AI replied")).toMatchObject({ ref: ch("c8") });
    const answer = answers(ch("c8"));
    expect(answer).toHaveLength(1);
    expect(answer[0]).toMatchObject({
      kind: "reply",
      state: "drafting",
      mailbox: "outreach1@gratovo.example",
      replyTo: real.outreach.thread(ch("c8"), 10).find((m) => m.direction === "in")?.id,
      approvedBy: null,
      sendAt: null,
    });
    expect(changed).toHaveBeenCalledWith(["log", "creators", "notify"]);
    expect(kicked).toBe(1);
    expect(afterWrites).toBe(1);
  });

  it("matches by the conversation key when there is no channel id", async () => {
    replies = [
      reply({
        channelId: null,
        conversationKey: `c:${ch("c9")}`,
        from: "someone@else.example",
        messageId: "gm-k",
      }),
    ];
    expect(await sweep.check()).toEqual({ ok: true, stored: 1 });
    expect((await creator(ch("c9")))?.stage).toBe("replied");
    expect(acked()).toEqual(["gm-k"]);
  });

  it("matches by the sender's address, ignoring case and a display name", async () => {
    replies = [
      reply({
        channelId: null,
        conversationKey: "other-thread",
        from: "Theo <BIZ@DiffusionDiaries.com>",
        messageId: "gm-e",
      }),
    ];
    expect(await sweep.check()).toEqual({ ok: true, stored: 1 });
    expect((await creator(ch("c9")))?.stage).toBe("replied");
    expect(real.outreach.thread(ch("c9"), 10).find((m) => m.direction === "in")?.peer).toBe(
      "BIZ@DiffusionDiaries.com",
    );
  });

  it("logs a reply it can't match by its id only, keeps it out of the table and does not acknowledge it", async () => {
    replies = [
      reply({
        channelId: "UCunknown00000000000000",
        conversationKey: "other",
        from: "stranger@nowhere.example",
        subject: "SECRET SUBJECT",
        body: "SECRET BODY",
        messageId: "gm-lost",
      }),
    ];
    expect(await sweep.check()).toEqual({ ok: true, stored: 0 });
    expect(real.outreach.storedGmailIds(["gm-lost"]).size).toBe(0);
    expect(acked()).toEqual([]);
    expect(jobs.map((j) => j.kind)).toEqual(["mail.replies"]);
    expect(lines).toEqual(["Reach: a reply wasn't matched to a creator (gm-lost)."]);
    expect(lines.join("")).not.toMatch(/SECRET|stranger/);
    expect(changed).not.toHaveBeenCalled();
  });

  it("stores a reply once: a second sweep changes nothing but is acknowledged again", async () => {
    replies = [reply()];
    await sweep.check();
    const afterFirst = (await real.frame()).notifications.length;
    expect(await sweep.check()).toEqual({ ok: true, stored: 0 });
    expect(real.outreach.thread(ch("c8"), 10).filter((m) => m.direction === "in")).toHaveLength(1);
    expect(answers(ch("c8"))).toHaveLength(1);
    expect((await real.frame()).notifications).toHaveLength(afterFirst);
    // Stored, so safe to acknowledge, and a lost ack is made good.
    expect(acked()).toEqual(["gm-r1", "gm-r1"]);
  });

  it("takes a reply named twice in one job once", async () => {
    replies = [reply(), reply()];
    expect(await sweep.check()).toEqual({ ok: true, stored: 1 });
    expect(acked()).toEqual(["gm-r1"]);
  });

  it("uses the clock when the reply has no valid time", async () => {
    replies = [
      reply({ receivedAt: null }),
      reply({ receivedAt: "yesterday-ish", messageId: "gm-2" }),
    ];
    await sweep.check();
    const times = real.outreach
      .thread(ch("c8"), 10)
      .filter((m) => m.direction === "in")
      .map((m) => m.at);
    expect(times).toEqual([contractNow, contractNow]);
  });

  it("makes one answer, one notification and one stop for two replies of one creator", async () => {
    replies = [
      reply({ messageId: "gm-a", receivedAt: new Date(contractNow - 2 * hour).toISOString() }),
      reply({
        messageId: "gm-b",
        receivedAt: new Date(contractNow - hour).toISOString(),
        body: "And one more thing.",
      }),
    ];
    expect(await sweep.check()).toEqual({ ok: true, stored: 2 });
    expect(answers(ch("c8"))).toHaveLength(1);
    // The answer replies to the newest.
    const newest = real.outreach
      .thread(ch("c8"), 10)
      .filter((m) => m.direction === "in")
      .at(-1);
    expect(answers(ch("c8"))[0]?.replyTo).toBe(newest?.id);
    expect(
      (await real.frame()).notifications.filter((n) => n.id.startsWith("reply-")),
    ).toHaveLength(1);
    expect(acked().sort()).toEqual(["gm-a", "gm-b"]);
  });

  it("queues no second answer when one is open already", async () => {
    replies = [reply({ messageId: "gm-a" })];
    await sweep.check();
    replies = [reply({ messageId: "gm-b" })];
    await sweep.check();
    expect(answers(ch("c8"))).toHaveLength(1);
  });

  it("moves a parked creator to replied too, and leaves a sequence stopped by you as it is", async () => {
    const parked = await real.frame();
    expect(parked.creators.find((c) => c.id === ch("c9"))?.stage).toBe("emailed");
    const sequence = real.outreach.sequence(ch("c9"));
    if (sequence === null) throw new Error("c9 has a sequence");
    real.outreach.commit({
      at: clock,
      sequences: [{ ...sequence, stopped: "you" }],
      writes: [
        {
          kind: "creator.stage",
          id: ch("c9"),
          stage: "parked",
          handle: "@diffusiondiaries",
          name: "Diffusion Diaries",
        },
      ],
    });
    replies = [
      reply({
        channelId: ch("c9"),
        conversationKey: `c:${ch("c9")}`,
        from: "biz@diffusiondiaries.com",
        messageId: "gm-p",
      }),
    ];
    await sweep.check();
    expect((await creator(ch("c9")))?.stage).toBe("replied");
    expect(real.outreach.sequence(ch("c9"))?.stopped).toBe("you");
  });

  it("stores the reply of a creator set to never contact and does nothing more", async () => {
    await real.write([
      { kind: "creator.stage", id: ch("c8"), stage: "never", handle: "@shipai", name: "Ship AI" },
    ]);
    replies = [reply()];
    expect(await sweep.check()).toEqual({ ok: true, stored: 1 });
    expect((await creator(ch("c8")))?.stage).toBe("never");
    expect(answers(ch("c8"))).toEqual([]);
    // The sequence still stops, so no follow-up goes out to someone who must not be written to.
    expect(real.outreach.sequence(ch("c8"))?.stopped).toBe("replied");
    expect((await real.frame()).notifications.some((n) => n.id.startsWith("reply-"))).toBe(false);
    expect(acked()).toEqual(["gm-r1"]);
  });
});

describe("a reply that can't be stored is not acknowledged", () => {
  it("stores nothing and acknowledges nothing when the commit fails", async () => {
    replies = [reply()];
    const failing = new Proxy(real, {
      get(target, key, receiver) {
        if (key === "outreach") {
          return {
            ...target.outreach,
            commit: () => {
              throw new Error("disk full: SECRET BODY");
            },
          };
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    open = failing;
    expect(await sweep.check()).toEqual({ ok: false, problem: "failed" });
    expect(acked()).toEqual([]);
    expect(jobs.map((j) => j.kind)).toEqual(["mail.replies"]);
    expect(lines).toEqual(["Reach: storing the replies failed."]);
    expect(real.outreach.storedGmailIds(["gm-r1"]).size).toBe(0);
    expect((await creator(ch("c8")))?.stage).toBe("emailed");
    // The reply is offered again, and the next sweep stores it.
    open = real;
    expect(await sweep.check()).toEqual({ ok: true, stored: 1 });
    expect(acked()).toEqual(["gm-r1"]);
  });

  it("tells a failed acknowledgement by its code and keeps the replies stored", async () => {
    replies = [reply()];
    ackAnswer = "failed";
    expect(await sweep.check()).toEqual({ ok: true, stored: 1 });
    expect(lines).toEqual(["Reach: the acknowledgement of replies failed (failed)."]);
    expect(real.outreach.storedGmailIds(["gm-r1"]).size).toBe(1);
  });

  it("acknowledges in chunks of 500", async () => {
    replies = Array.from({ length: 501 }, (_, i) => reply({ messageId: `gm-${String(i)}` }));
    expect(await sweep.check()).toEqual({ ok: true, stored: 501 });
    const chunks = jobs.flatMap((j) => (j.kind === "mail.ack" ? [j.messageIds.length] : []));
    expect(chunks).toEqual([500, 1]);
  });
});

describe("a bounce", () => {
  const bounce = (over: Partial<ReplyMessage> = {}): ReplyMessage =>
    reply({
      from: "mailer-daemon@googlemail.com",
      fromName: "Mail Delivery Subsystem",
      subject: "Delivery Status Notification (Failure)",
      body: "The address was not found.",
      messageId: "gm-b1",
      ...over,
    });

  it("stops the sequence as bounced, skips the follow-up, marks the address not confirmed, tells, and drafts no answer", async () => {
    followUp(ch("c8"));
    replies = [bounce()];
    expect(await sweep.check()).toEqual({ ok: true, stored: 1 });
    expect(real.outreach.sequence(ch("c8"))?.stopped).toBe("bounced");
    expect(real.outreach.draft(`fu-${ch("c8")}`)?.state).toBe("skipped");
    const now = await creator(ch("c8"));
    expect(now).toMatchObject({
      stage: "emailed",
      email: "team@shipai.dev",
      emailConfirmed: false,
    });
    // The label stays for a later confirm.
    const frame = await real.frame();
    expect(frame.notifications.find((n) => n.id.startsWith("bounce-"))).toMatchObject({
      icon: "alert",
      text: "Ship AI's email bounced",
      go: { screen: "reach", tab: "inbox" },
    });
    expect(frame.log.some((l) => l.text === "Ship AI's email bounced")).toBe(true);
    expect(answers(ch("c8"))).toEqual([]);
    expect(drafts().filter((d) => d.creator === ch("c8") && d.state !== "skipped")).toEqual([]);
    // The thread shows it as a bounce.
    expect(frame.reach.threads.find((t) => t.creator === ch("c8"))?.lastIn?.bounce).toBe(true);
    expect(acked()).toEqual(["gm-b1"]);
  });

  it("is recognised from postmaster@ too, and an unconfirmed address is not written again", async () => {
    replies = [bounce({ from: "Postmaster <postmaster@shipai.dev>" })];
    await sweep.check();
    expect(real.outreach.sequence(ch("c8"))?.stopped).toBe("bounced");
    const writes = vi.spyOn(real, "write");
    replies = [bounce({ messageId: "gm-b2" })];
    await sweep.check();
    expect(writes).not.toHaveBeenCalled();
    expect(real.outreach.thread(ch("c8"), 10).filter((m) => m.direction === "in")).toHaveLength(2);
  });

  it("is a reply when a real answer comes in the same sweep", async () => {
    replies = [bounce(), reply({ messageId: "gm-real" })];
    await sweep.check();
    expect((await creator(ch("c8")))?.stage).toBe("replied");
    expect((await creator(ch("c8")))?.emailConfirmed).toBe(true);
    expect(real.outreach.sequence(ch("c8"))?.stopped).toBe("replied");
    expect(answers(ch("c8"))).toHaveLength(1);
  });
});

describe("the sweep never sends and never approves", () => {
  it("leaves every draft out of approved, scheduled and sending, and asks for no mail.send", async () => {
    followUp(ch("c8"), "approved");
    followUp(ch("c9"), "scheduled");
    const before = drafts().filter((d) => ["approved", "scheduled"].includes(d.state)).length;
    expect(before).toBe(2);
    replies = [
      reply(),
      reply({
        messageId: "gm-9",
        channelId: ch("c9"),
        conversationKey: `c:${ch("c9")}`,
        from: "biz@diffusiondiaries.com",
      }),
    ];
    await sweep.check();
    await sweep.paste(ch("c8"), "Another thought.");
    await sweep.paste(ch("c9"), "And one from here.");
    const newest = real.outreach
      .thread(ch("c8"), 10)
      .filter((m) => m.direction === "in")
      .at(-1);
    await sweep.reclassify(newest?.id ?? noDraft, "inf.not_interested");
    expect(drafts().filter((d) => ["approved", "scheduled", "sending"].includes(d.state))).toEqual(
      [],
    );
    expect(
      drafts()
        // The seed's own two answers (dr6, dr7) wait for a person, ready.
        .filter((d) => d.kind === "reply" && !["dr6", "dr7"].includes(d.id))
        .every((d) => d.state === "drafting"),
    ).toBe(true);
    expect(jobs.filter((j) => j.kind === "mail.send")).toEqual([]);
    // The approved and scheduled follow-ups were skipped, not sent.
    expect(real.outreach.draft(`fu-${ch("c8")}`)?.state).toBe("skipped");
    expect(real.outreach.draft(`fu-${ch("c9")}`)?.state).toBe("skipped");
  });
});

describe("the timer", () => {
  it("does not run on example data", () => {
    mode = "example";
    sweep.start();
    expect(timers).toEqual([]);
  });

  it("sweeps 30 s after start and every 10 minutes after, and stops on stop", async () => {
    sweep.start();
    expect(timers.map((t) => t.ms)).toEqual([firstSweepMs]);
    expect(firstSweepMs).toBe(30_000);
    expect(sweepEveryMs).toBe(10 * 60_000);
    const first = timers[0];
    timers = [];
    first?.run();
    await vi.waitFor(() => {
      expect(jobs.map((j) => j.kind)).toEqual(["mail.replies"]);
      expect(timers.map((t) => t.ms)).toEqual([sweepEveryMs]);
    });
    sweep.stop();
    expect(timers).toEqual([]);
    // A tick that was already running does not arm another after the stop.
    first?.run();
    await vi.waitFor(() => {
      expect(jobs).toHaveLength(2);
    });
    expect(timers).toEqual([]);
  });

  it("arms one timer only when the data is closed and opened again under a running sweep", async () => {
    let release: (outcome: JobOutcome | null) => void = () => undefined;
    const slow = make({
      run: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    slow.start();
    const first = timers[0];
    timers = [];
    first?.run();
    await vi.waitFor(() => {
      expect(typeof release).toBe("function");
    });
    slow.stop();
    slow.start();
    expect(timers.map((t) => t.ms)).toEqual([firstSweepMs]);
    release(null);
    await vi.waitFor(() => {
      expect(lines).toEqual([]);
    });
    await Promise.resolve();
    expect(timers.map((t) => t.ms)).toEqual([firstSweepMs]);
    slow.stop();
  });

  it("keeps going after a sweep that had no mailbox", async () => {
    tokens = [];
    sweep.start();
    const first = timers[0];
    timers = [];
    first?.run();
    await vi.waitFor(() => {
      expect(timers.map((t) => t.ms)).toEqual([sweepEveryMs]);
    });
    expect(jobs).toEqual([]);
  });
});

describe("Paste a reply", () => {
  it("refuses with no data, an unknown creator and a creator with nothing sent", async () => {
    open = null;
    expect(await sweep.paste(ch("c8"), "Hi")).toEqual({ ok: false, problem: "no_data" });
    open = real;
    expect(await sweep.paste("UCnobody0000000000000000", "Hi")).toEqual({
      ok: false,
      problem: "not_found",
    });
    expect(await sweep.paste(ch("c6"), "Hi")).toEqual({ ok: false, problem: "no_outbound" });
    expect(real.outreach.thread(ch("c6"), 10)).toEqual([]);
  });

  it("stores a pasted in message and does what a swept reply does, minus the notification", async () => {
    followUp(ch("c9"));
    const before = (await real.frame()).notifications.length;
    expect(await sweep.paste(ch("c9"), "  Thanks Moustafa. My rate is $900 per video.  ")).toEqual({
      ok: true,
    });
    const message = real.outreach
      .thread(ch("c9"), 10)
      .filter((m) => m.direction === "in")
      .at(-1);
    expect(message).toMatchObject({
      source: "pasted",
      body: "Thanks Moustafa. My rate is $900 per video.",
      // The sequence's mailbox, the creator's address, no Gmail ids.
      mailbox: "outreach3@gratovo.example",
      peer: "biz@diffusiondiaries.com",
      peerName: "Theo",
      subject: "Re: Your image model comparison",
      by: null,
      reading: null,
    });
    expect(real.outreach.message(message?.id ?? noDraft)?.gmailMessageId).toBeNull();
    expect((await creator(ch("c9")))?.stage).toBe("replied");
    expect(real.outreach.sequence(ch("c9"))?.stopped).toBe("replied");
    expect(real.outreach.draft(`fu-${ch("c9")}`)?.state).toBe("skipped");
    const frame = await real.frame();
    expect(frame.notifications).toHaveLength(before);
    expect(frame.log.some((l) => l.text === "Added Diffusion Diaries's reply by hand")).toBe(true);
    expect(answers(ch("c9"))).toMatchObject([
      { state: "drafting", replyTo: message?.id, mailbox: "outreach3@gratovo.example" },
    ]);
    expect(jobs).toEqual([]);
    expect(kicked).toBe(1);
  });

  it("puts Re: before the subject of the last email out", async () => {
    await sweep.paste(ch("c8"), "First");
    expect(real.outreach.thread(ch("c8"), 10).at(-1)?.subject).toBe(
      "Re: Your video on shipping AI features",
    );
  });

  it("keeps the longest paste the page allows whole", async () => {
    await sweep.paste(ch("c8"), "a".repeat(20_000));
    const message = real.outreach
      .thread(ch("c8"), 10)
      .filter((m) => m.direction === "in")
      .at(-1);
    expect(message).toMatchObject({ bodyCut: false });
    expect(message?.body).toHaveLength(20_000);
  });
});

describe("the reading", () => {
  const proposal = (
    over: Partial<NonNullable<DraftProposal["situation"]>> = {},
  ): DraftProposal => ({
    status: "ready",
    why: "",
    rules: [],
    findings: [],
    gates: [],
    situation: {
      side: "influencer",
      stage: "replied",
      replyType: "inf.gives_rate",
      summary: "They gave a rate and some audience numbers for the video.",
      ...over,
    },
    model: "gemini",
  });

  async function pasted(text: string): Promise<{ draft: StoredDraft; messageId: string }> {
    await sweep.paste(ch("c9"), text);
    const draft = answers(ch("c9")).at(-1);
    if (draft === undefined || draft.replyTo === null) throw new Error("no answer draft");
    return { draft, messageId: draft.replyTo };
  }

  it("stores the label, the summary, the side and the facts read from the reply", async () => {
    const { draft, messageId } = await pasted(
      "My rate is $1,200. Audience mostly US and UK, ages 25-34.",
    );
    expect(await sweep.reading(draft, proposal())).toEqual({ bounce: false });
    expect(real.outreach.message(messageId)?.reading).toEqual({
      replyType: "inf.gives_rate",
      label: "Gives their rate or rate card",
      summary: "They gave a rate and some audience numbers for the video.",
      side: "influencer",
      corrected: false,
      facts: [
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
      ],
    });
    const thread = (await real.frame()).reach.threads.find((t) => t.creator === ch("c9"));
    expect(thread?.lastIn?.reading?.label).toBe("Gives their rate or rate card");
    expect(thread?.lastIn?.bounce).toBe(false);
  });

  it("takes the summary's first words for a type the playbook doesn't know, or none", async () => {
    const { draft, messageId } = await pasted("Maybe.");
    await sweep.reading(
      draft,
      proposal({
        replyType: "inf.brand_new",
        summary: "They are not sure yet about the whole idea of this.",
      }),
    );
    expect(real.outreach.message(messageId)?.reading?.label).toBe("They are not sure yet about");
    await sweep.reading(draft, proposal({ replyType: null }));
    expect(real.outreach.message(messageId)?.reading).toMatchObject({
      replyType: null,
      label: "They gave a rate and some",
    });
  });

  it("keeps a person's correction when the engine reads it again", async () => {
    const { draft, messageId } = await pasted("Maybe later.");
    await sweep.reclassify(messageId, "inf.not_interested");
    expect(await sweep.reading(draft, proposal())).toEqual({ bounce: false });
    expect(real.outreach.message(messageId)?.reading).toMatchObject({
      replyType: "inf.not_interested",
      corrected: true,
    });
  });

  it("does nothing for an answer with no reply, a proposal with no situation, or a reply that is gone", async () => {
    const { draft } = await pasted("Hello");
    const before = real.outreach.message(draft.replyTo ?? noDraft)?.reading;
    expect(await sweep.reading({ ...draft, replyTo: null }, proposal())).toEqual({ bounce: false });
    expect(await sweep.reading(draft, { ...proposal(), situation: null })).toEqual({
      bounce: false,
    });
    expect(await sweep.reading({ ...draft, replyTo: "gone" }, proposal())).toEqual({
      bounce: false,
    });
    expect(real.outreach.message(draft.replyTo ?? noDraft)?.reading).toEqual(before);
  });

  it("treats any.bounce as a bounce: stops the sequence as bounced, unconfirms the address, tells, and says so", async () => {
    followUp(ch("c9"));
    const { draft, messageId } = await pasted("Undeliverable: the address was not found.");
    expect(real.outreach.sequence(ch("c9"))?.stopped).toBe("replied");
    expect(
      await sweep.reading(
        draft,
        proposal({ replyType: "any.bounce", summary: "The address does not exist." }),
      ),
    ).toEqual({
      bounce: true,
    });
    expect(real.outreach.message(messageId)?.reading).toMatchObject({
      replyType: "any.bounce",
      label: "Bounce / address does not exist",
    });
    expect(real.outreach.sequence(ch("c9"))?.stopped).toBe("bounced");
    expect((await creator(ch("c9")))?.emailConfirmed).toBe(false);
    expect(
      (await real.frame()).notifications.some(
        (n) => n.text === "Diffusion Diaries's email bounced",
      ),
    ).toBe(true);
    // Reading it again changes nothing more.
    const logs = (await real.frame()).log.length;
    await sweep.reading(draft, proposal({ replyType: "any.bounce" }));
    expect((await real.frame()).log).toHaveLength(logs);
  });
});

describe("That's not it", () => {
  async function aReply(): Promise<{ messageId: string; draftId: string }> {
    await sweep.paste(ch("c9"), "Thanks, maybe later this year.");
    const draft = answers(ch("c9")).at(-1);
    if (draft?.replyTo == null) throw new Error("no answer draft");
    real.outreach.updateDraft(draft.id, { state: "ready", subject: "Re: x", body: "Hi" }, clock);
    real.outreach.commit({
      at: clock,
      readings: [
        {
          id: draft.replyTo,
          reading: {
            replyType: "inf.interested_vague",
            label: "Interested",
            summary: "They want to know more.",
            side: "influencer",
            corrected: false,
            facts: [{ key: "rate", rate: 900, saved: false }],
          },
        },
      ],
    });
    return { messageId: draft.replyTo, draftId: draft.id };
  }

  it("refuses a message that is not an in message, an unknown type and the other side's type", async () => {
    const { messageId } = await aReply();
    const out = real.outreach.thread(ch("c9"), 10).find((m) => m.direction === "out");
    expect(await sweep.reclassify(out?.id ?? noDraft, "inf.gives_rate")).toEqual({
      ok: false,
      problem: "not_found",
    });
    expect(await sweep.reclassify("nope", "inf.gives_rate")).toEqual({
      ok: false,
      problem: "not_found",
    });
    expect(await sweep.reclassify(messageId, "inf.no_such_thing")).toEqual({
      ok: false,
      problem: "unknown_type",
    });
    expect(await sweep.reclassify(messageId, "brd.yes")).toEqual({
      ok: false,
      problem: "unknown_type",
    });
    expect(real.outreach.message(messageId)?.reading?.corrected).toBe(false);
    expect(rereads).toEqual([]);
    open = null;
    expect(await sweep.reclassify(messageId, "inf.gives_rate")).toEqual({
      ok: false,
      problem: "no_data",
    });
  });

  it("sets the reading at once, marked corrected, keeping the summary and the facts, and writes the answer again", async () => {
    const { messageId, draftId } = await aReply();
    expect(await sweep.reclassify(messageId, "inf.not_interested")).toEqual({
      ok: true,
      rewritten: true,
    });
    expect(real.outreach.message(messageId)?.reading).toEqual({
      replyType: "inf.not_interested",
      label: "Not interested / no partnerships",
      summary: "They want to know more.",
      side: "influencer",
      corrected: true,
      facts: [{ key: "rate", rate: 900, saved: false }],
    });
    expect(rereads).toEqual([{ draftId, label: "Not interested / no partnerships" }]);
    expect(changed).toHaveBeenCalled();
  });

  it("accepts a type that fits either side", async () => {
    const { messageId } = await aReply();
    expect(await sweep.reclassify(messageId, "any.out_of_office")).toEqual({
      ok: true,
      rewritten: true,
    });
    expect(real.outreach.message(messageId)?.reading).toMatchObject({
      replyType: "any.out_of_office",
      corrected: true,
    });
  });

  it("changes only the reading when no answer is open", async () => {
    const { messageId, draftId } = await aReply();
    real.outreach.updateDraft(draftId, { state: "skipped" }, clock);
    expect(await sweep.reclassify(messageId, "inf.gives_rate")).toEqual({
      ok: true,
      rewritten: false,
    });
    expect(rereads).toEqual([]);
    expect(real.outreach.message(messageId)?.reading).toMatchObject({
      replyType: "inf.gives_rate",
    });
  });

  it("passes on the rewrite's refusals, with the reading changed all the same", async () => {
    const { messageId } = await aReply();
    for (const problem of ["bridge_off", "paused", "busy"] as const) {
      rereadAnswer = { ok: false, problem };
      expect(await sweep.reclassify(messageId, "inf.later_does_not_exist")).toEqual({
        ok: false,
        problem: "unknown_type",
      });
      expect(await sweep.reclassify(messageId, "inf.gives_rate")).toEqual({ ok: false, problem });
      expect(real.outreach.message(messageId)?.reading).toMatchObject({
        replyType: "inf.gives_rate",
        corrected: true,
      });
    }
    // No sender is not a reason this call knows: it is Gemini that can't write.
    rereadAnswer = { ok: false, problem: "no_sender" };
    expect(await sweep.reclassify(messageId, "inf.not_interested")).toEqual({
      ok: false,
      problem: "bridge_off",
    });
    // A draft that vanished in between is no reason to refuse.
    rereadAnswer = { ok: false, problem: "not_found" };
    expect(await sweep.reclassify(messageId, "inf.gives_rate")).toEqual({
      ok: true,
      rewritten: false,
    });
  });

  it("reading a reply as a bounce is a bounce: the open answer is set aside and nothing is rewritten", async () => {
    const { messageId, draftId } = await aReply();
    expect(await sweep.reclassify(messageId, "any.bounce")).toEqual({
      ok: true,
      rewritten: false,
    });
    expect(rereads).toEqual([]);
    expect(real.outreach.draft(draftId)?.state).toBe("skipped");
    expect(real.outreach.sequence(ch("c9"))?.stopped).toBe("bounced");
    expect((await creator(ch("c9")))?.emailConfirmed).toBe(false);
    expect(
      (await real.frame()).reach.threads.find((t) => t.creator === ch("c9"))?.lastIn?.bounce,
    ).toBe(true);
  });
});

describe("the situations", () => {
  it("serves id, label and side, and no_data with no data open", async () => {
    const answer = await sweep.situations();
    expect(answer).toEqual({
      ok: true,
      situations: situationList.map(({ id, label, side }) => ({ id, label, side })),
    });
    open = null;
    expect(await sweep.situations()).toEqual({ ok: false, problem: "no_data" });
  });
});

describe("review fixes (6d)", () => {
  const daemon = (over: Partial<ReplyMessage> = {}): ReplyMessage =>
    reply({
      from: "mailer-daemon@googlemail.com",
      subject: "Delivery Status Notification (Failure)",
      body: "The address was not found.",
      messageId: "gm-d1",
      ...over,
    });

  function park(id: string): void {
    const sequence = real.outreach.sequence(id);
    if (sequence === null) throw new Error("no sequence");
    real.outreach.commit({
      at: clock,
      sequences: [{ ...sequence, parkUntil: clock + 5 * 24 * hour }],
    });
  }

  it("clears parkUntil when a parked creator replies (sweep and paste)", async () => {
    park(ch("c8"));
    replies = [reply()];
    await sweep.check();
    expect(real.outreach.sequence(ch("c8"))).toMatchObject({ stopped: "replied", parkUntil: null });
    park(ch("c9"));
    await sweep.paste(ch("c9"), "Thanks!");
    expect(real.outreach.sequence(ch("c9"))).toMatchObject({ stopped: "replied", parkUntil: null });
  });

  it("clears parkUntil when a reading turns a reply into a bounce", async () => {
    await sweep.paste(ch("c9"), "Undeliverable.");
    const draft = answers(ch("c9")).at(-1);
    if (draft === undefined) throw new Error("no answer");
    park(ch("c9"));
    await sweep.reading(draft, {
      status: "ready",
      why: "",
      rules: [],
      findings: [],
      gates: [],
      situation: { side: "any", stage: "replied", replyType: "any.bounce", summary: "Bounced." },
      model: "gemini",
    });
    expect(real.outreach.sequence(ch("c9"))).toMatchObject({ stopped: "bounced", parkUntil: null });
  });

  it("puts the stage back to emailed and swaps the replied notice for the bounce one when a reading finds a bounce", async () => {
    replies = [reply()];
    await sweep.check();
    expect((await creator(ch("c8")))?.stage).toBe("replied");
    const draft = answers(ch("c8"))[0];
    if (draft === undefined) throw new Error("no answer");
    await sweep.reclassify(draft.replyTo ?? noDraft, "any.bounce");
    expect((await creator(ch("c8")))?.stage).toBe("emailed");
    const notices = (await real.frame()).notifications;
    expect(notices.filter((n) => n.text === "Ship AI replied")).toEqual([]);
    expect(notices.filter((n) => n.text === "Ship AI's email bounced")).toHaveLength(1);
  });

  it("keeps the stage replied when another real reply is in", async () => {
    replies = [
      reply({ messageId: "gm-a", receivedAt: new Date(contractNow - 2 * hour).toISOString() }),
    ];
    await sweep.check();
    replies = [reply({ messageId: "gm-b" })];
    await sweep.check();
    const bounced = real.outreach.thread(ch("c8"), 10).filter((m) => m.direction === "in")[1];
    await sweep.reclassify(bounced?.id ?? noDraft, "any.bounce");
    expect((await creator(ch("c8")))?.stage).toBe("replied");
  });

  it("keeps the address's source and confidence when a bounce unconfirms it", async () => {
    await real.write([
      {
        kind: "creator.contact",
        id: ch("c8"),
        email: "team@shipai.dev",
        confirmed: true,
        contactName: null,
        source: "about",
        confidence: 0.8,
        handle: "@shipai",
        name: "Ship AI",
      },
    ]);
    replies = [daemon()];
    await sweep.check();
    expect(await creator(ch("c8"))).toMatchObject({
      emailConfirmed: false,
      contactSource: "about",
      contactConfidence: 0.8,
    });
  });

  it("stops the sequence and skips follow-ups of a rejected creator who replies, with no stage, notice or answer", async () => {
    followUp(ch("c8"));
    await real.write([
      {
        kind: "creator.stage",
        id: ch("c8"),
        stage: "rejected",
        handle: "@shipai",
        name: "Ship AI",
      },
    ]);
    replies = [reply()];
    await sweep.check();
    expect(real.outreach.sequence(ch("c8"))).toMatchObject({ stopped: "replied", parkUntil: null });
    expect(real.outreach.draft(`fu-${ch("c8")}`)?.state).toBe("skipped");
    expect((await creator(ch("c8")))?.stage).toBe("rejected");
    expect(answers(ch("c8"))).toEqual([]);
    expect((await real.frame()).notifications.some((n) => n.id.startsWith("reply-"))).toBe(false);
  });

  it("says rewritten false when the answer is still drafting", async () => {
    await sweep.paste(ch("c9"), "Maybe later.");
    const messageId = answers(ch("c9"))[0]?.replyTo ?? noDraft;
    expect(await sweep.reclassify(messageId, "inf.gives_rate")).toEqual({
      ok: true,
      rewritten: false,
    });
    expect(rereads).toEqual([]);
  });

  it("acknowledges a stored reply that no longer matches, and logs an unmatched one once per run", async () => {
    replies = [reply()];
    await sweep.check();
    replies = [
      reply({ channelId: "UCgone", conversationKey: "x", from: "z@z.example" }),
      reply({
        messageId: "gm-lost",
        channelId: "UCgone",
        conversationKey: "x",
        from: "z@z.example",
      }),
    ];
    await sweep.check();
    await sweep.check();
    expect(acked()).toEqual(["gm-r1", "gm-r1", "gm-r1"]);
    expect(lines.filter((l) => l.includes("gm-lost"))).toHaveLength(1);
  });

  it("leaves a reply from an address two creators share unmatched", async () => {
    await real.write([
      {
        kind: "creator.contact",
        id: ch("c9"),
        email: "team@shipai.dev",
        confirmed: false,
        contactName: null,
        source: null,
        confidence: null,
        handle: "@diffusiondiaries",
        name: "Diffusion Diaries",
      },
    ]);
    replies = [reply({ channelId: null, conversationKey: "other" })];
    expect(await sweep.check()).toEqual({ ok: true, stored: 0 });
    expect(lines).toEqual(["Reach: a reply wasn't matched to a creator (gm-r1)."]);
    expect(acked()).toEqual([]);
  });

  it("stores and acknowledges a reply older than 30 days with no stage, notice or answer", async () => {
    replies = [reply({ receivedAt: new Date(contractNow - 31 * 24 * hour).toISOString() })];
    expect(await sweep.check()).toEqual({ ok: true, stored: 1 });
    expect((await creator(ch("c8")))?.stage).toBe("emailed");
    expect(answers(ch("c8"))).toEqual([]);
    expect(real.outreach.sequence(ch("c8"))?.stopped).toBeNull();
    expect((await real.frame()).notifications.some((n) => n.id.startsWith("reply-"))).toBe(false);
    expect(lines).toEqual(["Reach: 1 old replies were stored without action."]);
    expect(acked()).toEqual(["gm-r1"]);
  });

  it("answers situations with none when the playbook file is missing, and a reclassify unknown_type", async () => {
    const bare = make({
      situations: { list: () => Promise.resolve([]), labelOf: () => Promise.resolve(null) },
    });
    expect(await bare.situations()).toEqual({ ok: true, situations: [] });
    await sweep.paste(ch("c9"), "Hello");
    const messageId = answers(ch("c9"))[0]?.replyTo ?? noDraft;
    expect(await bare.reclassify(messageId, "inf.gives_rate")).toEqual({
      ok: false,
      problem: "unknown_type",
    });
  });
});
