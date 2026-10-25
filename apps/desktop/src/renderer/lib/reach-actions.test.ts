// @vitest-environment happy-dom
import { exampleFrame } from "@gratovo/core/data";
import type { Frame, ReachData } from "@gratovo/core/data";
import type { Bridge } from "@gratovo/ipc/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { strings } from "../strings";
import { undo } from "./actions";
import { installLiveUpdates } from "./live";
import { adoptServerData, diffData, installPersistence, persistenceIdle } from "./persist";
import {
  cancelScheduled,
  confirmGate,
  dayWords,
  draftNow,
  loadThread,
  markSent,
  noticeReachChange,
  retryDraft,
  rewriteDraft,
  scheduleDraft,
  sendAsNew,
  sendDraft,
  sendTest,
  setDraftMailbox,
  setMailbox,
  parkCreator,
  resumeSequence,
  skipDraft,
  stopSequence,
  wakeCreator,
  typeDraft,
  undoRewrite,
} from "./reach-actions";
import { aiDraft, goodMailbox, reachWith, stubReachBridge } from "./reach-test-bridge";
import { appStore, resetAppStoreForTests } from "./store";

const t = strings.reach;
const now = new Date(2026, 9, 24, 10, 0, 0).getTime();
const address = "sam@gratovo.example";

const data = () => appStore().getState().data;
const toasts = () => appStore().getState().ui.toasts;
const draft = (id: string) => data().reach.drafts.find((d) => d.id === id);

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

/** Puts Reach in the store as saved (server data), with creator 1 ready to be emailed. */
function setReach(reach: ReachData): string {
  const creator = data().creators[0];
  if (creator === undefined) {
    throw new Error("the example has no creator");
  }
  adoptServerData((d) => {
    const c = d.creators.find((x) => x.id === creator.id);
    if (c !== undefined) {
      c.stage = "contact";
      c.email = "biz@promptlab.example";
      c.emailConfirmed = true;
    }
    d.reach = reach as typeof d.reach;
  });
  return creator.id;
}

let bridge = stubReachBridge();
let uninstall: () => void = () => undefined;

function install(answers: Record<string, unknown> = {}): void {
  bridge = stubReachBridge(answers);
  uninstall();
  uninstall = installPersistence(((channel: string, input: unknown) =>
    window.gratovo.invoke(channel as "data:write", input as never)) as Bridge["invoke"]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetAppStoreForTests({ screen: "reach", tab: null }, now);
  install();
});

afterEach(async () => {
  await settle();
  expect(persistenceIdle()).toBe(true);
  uninstall();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("diffData for drafts", () => {
  const base = () => {
    const before = data();
    return before;
  };

  it("writes a state change between person states with sendAt", () => {
    setReach(reachWith({ drafts: [aiDraft("d1", "c")], mailboxes: [] }));
    const before = base();
    const was = before.reach.drafts[0];
    if (was === undefined) {
      throw new Error("no draft");
    }
    const after = {
      ...before,
      reach: { ...before.reach, drafts: [{ ...was, state: "approved" as const, sendAt: 5 }] },
    };
    expect(diffData(before, after)).toEqual({
      writes: [{ kind: "draft.state", id: "d1", state: "approved", sendAt: 5 }],
      unsupported: [],
    });
  });

  it("writes text, mailbox and gate changes", () => {
    setReach(reachWith({ drafts: [aiDraft("d1", "c", { gatesOk: ["a"] })] }));
    const before = base();
    const was = before.reach.drafts[0];
    if (was === undefined) {
      throw new Error("no draft");
    }
    const after = {
      ...before,
      reach: {
        ...before.reach,
        drafts: [
          {
            ...was,
            subject: "New",
            body: "Text",
            mailbox: "o@x.example",
            gatesOk: ["b"],
            edited: true,
          },
        ],
      },
    };
    expect(diffData(before, after)).toEqual({
      writes: [
        { kind: "draft.text", id: "d1", subject: "New", body: "Text" },
        { kind: "draft.mailbox", id: "d1", mailbox: "o@x.example" },
        { kind: "draft.gate", id: "d1", gate: "b", ok: true },
        { kind: "draft.gate", id: "d1", gate: "a", ok: false },
      ],
      unsupported: [],
    });
  });

  it("reports what a person can't set as unsupported, and writes nothing for it", () => {
    setReach(reachWith({ drafts: [aiDraft("d1", "c")], mailboxes: [goodMailbox(address)] }));
    const before = base();
    const was = before.reach.drafts[0];
    if (was === undefined) {
      throw new Error("no draft");
    }
    const sent = {
      ...before,
      reach: { ...before.reach, drafts: [{ ...was, state: "sent" as const }] },
    };
    expect(diffData(before, sent)).toEqual({ writes: [], unsupported: ["reach"] });
    const removed = { ...before, reach: { ...before.reach, drafts: [] } };
    expect(diffData(before, removed).unsupported).toEqual(["reach"]);
    const threads = { ...before, reach: { ...before.reach, sender: "Someone" } };
    expect(diffData(before, threads).unsupported).toEqual(["reach"]);
    const mailboxes = { ...before, reach: { ...before.reach, mailboxes: [] } };
    expect(diffData(before, mailboxes).unsupported).toEqual(["reach"]);
  });

  it("writes nothing for server data adopted into the store", async () => {
    setReach(reachWith({ drafts: [aiDraft("d1", "c")] }));
    await settle();
    expect(bridge.writes).toEqual([]);
  });
});

describe("mergeServerData for Reach", () => {
  function serverWith(reach: ReachData): Frame {
    return { ...exampleFrame(now), reach };
  }

  it("takes the server's news by id and keeps your own Send undoable after it comes back", async () => {
    const id = setReach(
      reachWith({ drafts: [aiDraft("d1", id0())], mailboxes: [goodMailbox(address)] }),
    );
    expect(id).not.toBe("");
    let fire: (payload: unknown) => void = () => undefined;
    const frameInvoke = vi.fn((channel: string, input: unknown) =>
      channel === "frame:load"
        ? Promise.resolve({ ok: true, value: server })
        : window.gratovo.invoke(channel as "data:write", input as never),
    );
    let server = serverWith(data().reach);
    const stop = installLiveUpdates({
      invoke: frameInvoke as unknown as Bridge["invoke"],
      on: ((event: string, listener: (payload: unknown) => void) => {
        if (event === "frame:changed") {
          fire = listener;
        }
        return () => undefined;
      }) as Bridge["on"],
    });
    try {
      expect(sendDraft("d1")).toBe(true);
      await settle();
      const approved = draft("d1");
      expect(approved?.state).toBe("approved");
      // Main echoes the approved draft back with its own hold and change time (it sets both, D11),
      // and a teammate-made thread appears. Its own times must not count as news for the undo
      // steps: Undo still takes the send back.
      server = serverWith({
        ...data().reach,
        drafts:
          approved === undefined
            ? []
            : [
                {
                  ...approved,
                  sendAt: (approved.sendAt ?? 0) + 37,
                  updatedAt: approved.updatedAt + 37,
                },
              ],
        sender: "Sam",
        gemini: "ready",
        // A draft written after the first load gets its zone in a later frame.
        zones: { [id0()]: "America/New_York" },
      });
      fire({ parts: ["reach"] });
      await vi.advanceTimersByTimeAsync(1500);
      await settle();
      expect(data().reach.sender).toBe("Sam");
      expect(data().reach.gemini).toBe("ready");
      expect(data().reach.zones).toEqual({ [id0()]: "America/New_York" });
      undo();
      await settle();
      expect(draft("d1")?.state).toBe("ready");
      expect(bridge.writes.flat()).toEqual([
        expect.objectContaining({ kind: "draft.state", state: "approved" }),
        expect.objectContaining({ kind: "draft.state", state: "ready", sendAt: null }),
      ]);
    } finally {
      stop();
    }
  });
});

function id0(): string {
  const creator = exampleFrame(now).creators[0];
  if (creator === undefined) {
    throw new Error("the example has no creator");
  }
  return creator.id;
}

describe("sendDraft", () => {
  it("approves the draft with the 10 s hold, toasts with Undo, and writes draft.state", async () => {
    setReach(reachWith({ drafts: [aiDraft("d1", id0())], mailboxes: [goodMailbox(address)] }));
    const name = data().creators[0]?.name ?? "";
    expect(sendDraft("d1")).toBe(true);
    expect(draft("d1")).toMatchObject({ state: "approved", sendAt: now + 10_000 });
    const shown = toasts().at(-1);
    expect(shown).toMatchObject({
      msg: t.sentTo(name),
      sub: `${t.nextFollowUp(1, dayWords(now + 10_000 + 3 * 86_400_000))}. ${t.sentSub(address)}`,
      ms: 10_000,
    });
    expect(shown?.actions.map((a) => a.label)).toEqual([strings.actions.undo]);
    expect(data().log.some((l) => l.text === t.sentLabel.first(name))).toBe(false);
    await settle();
    expect(bridge.writes).toEqual([
      [{ kind: "draft.state", id: "d1", state: "approved", sendAt: now + 10_000 }],
    ]);
    shown?.actions[0]?.run();
    await settle();
    expect(draft("d1")).toMatchObject({ state: "ready", sendAt: null });
    expect(bridge.writes.at(-1)).toEqual([
      { kind: "draft.state", id: "d1", state: "ready", sendAt: null },
    ]);
  });

  it("names a follow-up and an answer in the label", () => {
    setReach(
      reachWith({
        drafts: [
          aiDraft("f", id0(), { kind: "followUp", followUp: 2 }),
          aiDraft("r", id0(), { kind: "reply" }),
        ],
        mailboxes: [goodMailbox(address)],
      }),
    );
    const name = data().creators[0]?.name ?? "";
    expect(sendDraft("f")).toBe(true);
    expect(appStore().peekUndo()?.label).toBe(t.sentLabel.followUp(2, name));
    expect(sendDraft("r")).toBe(true);
    expect(appStore().peekUndo()?.label).toBe(t.sentLabel.reply(name));
  });

  it("refuses with the first gate's words while a gate holds it", async () => {
    setReach(
      reachWith({
        drafts: [aiDraft("d1", id0())],
        mailboxes: [goodMailbox(address, { paused: true })],
      }),
    );
    expect(sendDraft("d1")).toBe(false);
    expect(draft("d1")?.state).toBe("ready");
    expect(toasts().at(-1)).toMatchObject({
      msg: t.stillNeedsYou,
      sub: t.gates.mailbox_paused(address),
    });
    await settle();
    expect(bridge.writes).toEqual([]);
  });

  it("refuses an unconfirmed engine gate until it is confirmed", () => {
    const proposal = aiDraft("x", "c").proposal;
    if (proposal === null) {
      throw new Error("no proposal");
    }
    setReach(
      reachWith({
        drafts: [
          aiDraft("d1", id0(), {
            proposal: {
              ...proposal,
              gates: [{ key: "price", kind: "price", text: "It names a price." }],
            },
          }),
        ],
        mailboxes: [goodMailbox(address)],
      }),
    );
    expect(sendDraft("d1")).toBe(false);
    expect(toasts().at(-1)?.sub).toBe("It names a price.");
    expect(confirmGate("d1", "price")).toBe(true);
    expect(draft("d1")?.gatesOk).toEqual(["price"]);
    expect(confirmGate("d1", "price")).toBe(false);
    expect(confirmGate("d1", "nothing")).toBe(false);
    expect(sendDraft("d1")).toBe(true);
  });

  it("does nothing for a draft that is not ready", () => {
    setReach(
      reachWith({
        drafts: [aiDraft("d1", id0(), { state: "sending" })],
        mailboxes: [goodMailbox(address)],
      }),
    );
    expect(sendDraft("d1")).toBe(false);
    expect(sendDraft("missing")).toBe(false);
  });
});

describe("skipDraft", () => {
  it("skips a ready draft with the prototype's words and writes draft.state", async () => {
    setReach(
      reachWith({
        drafts: [aiDraft("d1", id0()), aiDraft("d2", id0(), { kind: "followUp", followUp: 1 })],
        mailboxes: [goodMailbox(address)],
      }),
    );
    expect(skipDraft("d1")).toBe(true);
    expect(toasts().at(-1)).toMatchObject({ msg: t.skipped, sub: t.skippedSub });
    expect(skipDraft("d2")).toBe(true);
    expect(toasts().at(-1)?.sub).toBe(t.skippedSubFollowUp);
    await settle();
    expect(bridge.writes.flat()).toEqual([
      { kind: "draft.state", id: "d1", state: "skipped", sendAt: null },
      { kind: "draft.state", id: "d2", state: "skipped", sendAt: null },
    ]);
  });

  it("refuses a draft that is already on its way", () => {
    setReach(reachWith({ drafts: [aiDraft("d1", id0(), { state: "sent" })] }));
    expect(skipDraft("d1")).toBe(false);
  });
});

describe("setDraftMailbox", () => {
  it("changes a first email's mailbox, writes draft.mailbox, and refuses a follow-up", async () => {
    setReach(
      reachWith({
        drafts: [aiDraft("d1", id0()), aiDraft("f", id0(), { kind: "followUp", followUp: 1 })],
        mailboxes: [goodMailbox(address), goodMailbox("omar@gratovo.example")],
      }),
    );
    expect(setDraftMailbox("d1", "omar@gratovo.example")).toBe(true);
    expect(draft("d1")?.mailbox).toBe("omar@gratovo.example");
    expect(setDraftMailbox("f", "omar@gratovo.example")).toBe(false);
    expect(setDraftMailbox("d1", "unknown@gratovo.example")).toBe(false);
    await settle();
    expect(bridge.writes.flat()).toEqual([
      { kind: "draft.mailbox", id: "d1", mailbox: "omar@gratovo.example" },
    ]);
  });
});

describe("rewriting", () => {
  it("asks main, says why when it can't, and lets the new text undo", async () => {
    setReach(reachWith({ drafts: [aiDraft("d1", id0())] }));
    install({ "reach:rewrite": { ok: false, problem: "bridge_off" } });
    expect(await rewriteDraft("d1", "shorter")).toBe(false);
    expect(bridge.calls).toEqual([["reach:rewrite", { draftId: "d1", how: "shorter" }]]);
    expect(toasts().at(-1)).toMatchObject({ msg: t.rewriteProblems.bridge_off });

    install({ "reach:rewrite": { ok: true } });
    const old = draft("d1");
    expect(await rewriteDraft("d1", "warmer")).toBe(true);
    // Main's answer arrives as server data: the rewrite shows, then the new text.
    const before = data().reach;
    adoptServerData((d) => {
      const target = d.reach.drafts.find((x) => x.id === "d1");
      if (target !== undefined) {
        target.subject = "Warmer subject";
        target.body = "Warmer body";
      }
    });
    noticeReachChange(before, data().reach);
    const shown = toasts().at(-1);
    expect(shown?.msg).toBe(t.rewritten(t.hows.warmer));
    shown?.actions[0]?.run();
    await settle();
    expect(draft("d1")).toMatchObject({ subject: old?.subject, body: old?.body });
    expect(bridge.writes.at(-1)).toEqual([
      { kind: "draft.text", id: "d1", subject: old?.subject, body: old?.body },
    ]);
    // Said once.
    const count = toasts().length;
    noticeReachChange(before, data().reach);
    expect(toasts().length).toBe(count);
  });

  it("puts old text back with undoRewrite as an act", async () => {
    setReach(reachWith({ drafts: [aiDraft("d1", id0())] }));
    expect(undoRewrite("d1", "S", "B")).toBe(true);
    expect(undoRewrite("d1", "S", "B")).toBe(false);
    undo();
    await settle();
    expect(bridge.writes.flat().map((w) => w.kind)).toEqual(["draft.text", "draft.text"]);
  });
});

describe("typeDraft", () => {
  it("writes draft.text straight through and takes it as saved, with no undo step", async () => {
    setReach(reachWith({ drafts: [aiDraft("d1", id0())] }));
    const steps = appStore().peekUndo()?.id;
    expect(await typeDraft("d1", "S", "B")).toBe(true);
    expect(draft("d1")).toMatchObject({ subject: "S", body: "B", edited: true });
    expect(appStore().peekUndo()?.id).toBe(steps);
    expect(bridge.calls).toEqual([
      ["data:write", { writes: [{ kind: "draft.text", id: "d1", subject: "S", body: "B" }] }],
    ]);
    expect(await typeDraft("d1", "S", "B")).toBe(false);
  });
});

describe("main calls", () => {
  it("retry, mark sent and send as new call their channel and toast", async () => {
    install({ "reach:retry": { ok: true }, "reach:mark-sent": { ok: true } });
    expect(await retryDraft("d1")).toBe(true);
    expect(toasts().at(-1)?.msg).toBe(t.retryStarted);
    expect(await markSent("d1")).toBe(true);
    expect(toasts().at(-1)?.msg).toBe(t.markedSent);
    install({ "reach:send-new": { ok: false, problem: "wrong_state" } });
    expect(await sendAsNew("d1")).toBe(false);
    expect(toasts().at(-1)?.msg).toBe(t.actionProblems.wrong_state);
    expect(bridge.calls).toEqual([["reach:send-new", { draftId: "d1" }]]);
  });

  it("draft now says what main answered, and the thread loads", async () => {
    install({ "reach:draft-now": { ok: false, problem: "has_draft" } });
    expect(await draftNow("c1")).toBe(false);
    expect(toasts().at(-1)?.msg).toBe(t.draftNowProblems.has_draft);
    install({ "reach:draft-now": { ok: true }, "reach:thread": { ok: true, messages: [] } });
    expect(await draftNow("c1")).toBe(true);
    expect(await loadThread("c1")).toEqual([]);
  });
});

describe("too late to undo", () => {
  it("says so once when a draft the page holds as ready is sending or sent", () => {
    setReach(reachWith({ drafts: [aiDraft("d1", id0())] }));
    const before = data().reach;
    const gone = reachWith({ drafts: [aiDraft("d1", id0(), { state: "sending" })] });
    noticeReachChange(before, gone);
    expect(toasts().at(-1)?.msg).toBe(t.tooLate);
    const count = toasts().length;
    noticeReachChange(gone, reachWith({ drafts: [aiDraft("d1", id0(), { state: "sent" })] }));
    expect(toasts().length).toBe(count);
  });

  it("says too late to cancel when a Cancel met a send already going", () => {
    setReach(
      reachWith({ drafts: [aiDraft("d1", id0(), { state: "scheduled", sendAt: now + 5 })] }),
    );
    expect(cancelScheduled("d1")).toBe(true);
    const before = data().reach;
    noticeReachChange(before, reachWith({ drafts: [aiDraft("d1", id0(), { state: "sending" })] }));
    expect(toasts().at(-1)?.msg).toBe(t.tooLateCancel);
  });

  it("stays quiet when a draft the page holds as approved goes out", () => {
    const approved = reachWith({
      drafts: [aiDraft("d1", id0(), { state: "approved", sendAt: 1 })],
    });
    noticeReachChange(
      approved,
      reachWith({ drafts: [aiDraft("d1", id0(), { state: "sending" })] }),
    );
    expect(toasts()).toHaveLength(0);
  });
});

describe("Send later and mailbox settings", () => {
  const later = strings.reach.later;

  it("schedules a ready draft, writes draft.state with sendAt, and refuses a past time", async () => {
    const creator = setReach(
      reachWith({ drafts: [aiDraft("d1", "c1")], mailboxes: [goodMailbox(address)] }),
    );
    adoptServerData((d) => {
      const target = d.reach.drafts[0];
      if (target !== undefined) {
        target.creator = creator;
      }
    });
    expect(scheduleDraft("d1", now - 1)).toBe(false);
    const at = now + 86_400_000;
    expect(scheduleDraft("d1", at)).toBe(true);
    await settle();
    expect(draft("d1")).toMatchObject({ state: "scheduled", sendAt: at });
    expect(bridge.writes.at(-1)).toEqual([
      { kind: "draft.state", id: "d1", state: "scheduled", sendAt: at },
    ]);
    expect(scheduleDraft("d1", at + 1)).toBe(false);
    expect(cancelScheduled("d1")).toBe(true);
    expect(draft("d1")).toMatchObject({ state: "ready", sendAt: null });
    expect(toasts().at(-1)?.msg).toBe(later.cancelled);
    expect(cancelScheduled("d1")).toBe(false);
  });

  it("refuses to schedule while a gate holds the draft", () => {
    setReach(reachWith({ drafts: [aiDraft("d1", "c1")], mailboxes: [] }));
    expect(scheduleDraft("d1", now + 86_400_000)).toBe(false);
    expect(draft("d1")?.state).toBe("ready");
    expect(toasts().at(-1)?.msg).toBe(t.stillNeedsYou);
  });

  it("sets a mailbox through main with no Undo, and says when it fails", async () => {
    install({ "reach:mailbox-set": { ok: false, problem: "no_data" } });
    expect(await setMailbox(address, { dailyCap: 40 })).toBe(false);
    expect(toasts().at(-1)?.msg).toBe(t.mailboxes.setProblems.no_data);
    install();
    expect(await setMailbox(address, { dailyCap: 40 })).toBe(true);
    expect(bridge.calls.at(-1)).toEqual(["reach:mailbox-set", { address, dailyCap: 40 }]);
    expect(toasts().at(-1)).toMatchObject({ msg: t.mailboxes.capToast("sam", 40), actions: [] });
  });

  it("sends a test and gives each problem a toast", async () => {
    expect(await sendTest(address)).toBe(true);
    expect(toasts().at(-1)?.msg).toBe(t.mailboxes.testSent(address));
    install({ "reach:send-test": { ok: false, problem: "signed_out" } });
    expect(await sendTest(address)).toBe(false);
    expect(toasts().at(-1)?.msg).toBe(t.mailboxes.testProblems.signed_out);
  });
});

describe("the sequence commands", () => {
  const day = 86_400_000;
  const toastUndo = async () => {
    toasts().at(-1)?.actions[0]?.run();
    await settle();
  };

  it("stops, and Undo resumes", async () => {
    install();
    const id = id0();
    const name = data().creators[0]?.name ?? "";
    expect(await stopSequence(id)).toBe(true);
    expect(bridge.calls.at(-1)).toEqual(["reach:sequence-stop", { creatorId: id }]);
    expect(toasts().at(-1)?.msg).toBe(t.sequences.toasts.stopped(name));
    await toastUndo();
    expect(bridge.calls.at(-1)).toEqual(["reach:sequence-resume", { creatorId: id }]);
    expect(toasts().at(-1)?.actions).toEqual([]);
  });

  it("resumes, and Undo stops", async () => {
    install();
    expect(await resumeSequence("c")).toBe(true);
    await toastUndo();
    expect(bridge.calls.at(-1)).toEqual(["reach:sequence-stop", { creatorId: "c" }]);
  });

  it("parks, and Undo wakes", async () => {
    install();
    const until = Date.now() + 14 * day;
    expect(await parkCreator("c", until)).toBe(true);
    expect(bridge.calls.at(-1)).toEqual(["reach:park", { creatorId: "c", until }]);
    expect(toasts().at(-1)?.msg).toContain(dayWords(until));
    await toastUndo();
    expect(bridge.calls.at(-1)).toEqual(["reach:wake", { creatorId: "c" }]);
  });

  it("wakes, and Undo parks again until the old day", async () => {
    install();
    const until = Date.now() + 5 * day;
    setReach(
      reachWith({
        sequences: [
          {
            creator: "c",
            mailbox: address,
            startedAt: 1,
            steps: [],
            stopped: null,
            parkUntil: until,
          },
        ],
      }),
    );
    expect(await wakeCreator("c")).toBe(true);
    await toastUndo();
    expect(bridge.calls.at(-1)).toEqual(["reach:park", { creatorId: "c", until }]);
  });

  it("toasts a refusal plainly, with no Undo", async () => {
    install({ "reach:park": { ok: false, problem: "wrong_state" } });
    expect(await parkCreator("c", Date.now() + day)).toBe(false);
    expect(toasts().at(-1)).toMatchObject({ msg: t.sequences.problems.wrong_state, actions: [] });
  });
});

describe("the send toast names what follows", () => {
  it("says the last follow-up was the last, or names the next", () => {
    const id = id0();
    const sequence = {
      creator: id,
      mailbox: address,
      startedAt: now,
      steps: [
        { n: 1, dueAt: now, state: "planned" as const, sentAt: null },
        { n: 2, dueAt: now + 4 * 86_400_000, state: "planned" as const, sentAt: null },
      ],
      stopped: null,
      parkUntil: null,
    };
    setReach(
      reachWith({
        drafts: [
          aiDraft("f1", id, { kind: "followUp", followUp: 1 }),
          aiDraft("f2", id, { kind: "followUp", followUp: 2 }),
        ],
        mailboxes: [goodMailbox(address)],
        sequences: [sequence],
      }),
    );
    sendDraft("f1");
    expect(toasts().at(-1)?.sub).toContain(t.nextFollowUp(2, dayWords(now + 4 * 86_400_000)));
    sendDraft("f2");
    expect(toasts().at(-1)?.sub).toContain(t.lastFollowUp);
  });
});
