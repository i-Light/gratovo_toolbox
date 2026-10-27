import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DataSource, DraftState } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contractNow } from "../data/data-source-contract";
import { openExampleSource } from "../data/example-source";

import { createReachService, type ReachServiceHandle } from "./reach-service";

/**
 * Close's Decline kindly and Ask for what's missing in main (plan step 8, D6 and D7), on the real
 * example source in a temp file: c14 is at kit and passes, c15 fails the audience check, c16 is at
 * kit with its engagement missing, c10 replied.
 */

const allStates: readonly DraftState[] = [
  "drafting",
  "ready",
  "failed",
  "approved",
  "scheduled",
  "sending",
  "sent",
  "skipped",
];

let folder: string;
let source: DataSource;
let clock: number;
let service: ReachServiceHandle;
let emitted: number;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-signing-"));
  clock = contractNow;
  emitted = 0;
  source = openExampleSource(join(folder, "example.db"), () => clock);
  service = createReachService({
    mode: () => "example",
    source: () => source,
    gemini: {
      status: () => ({
        state: "stopped",
        addon: { state: "missing", version: null },
        browser: null,
        problem: null,
      }),
      call: vi.fn() as never,
    },
    jobs: { jobContext: () => null, secrets: {} as never },
    runQuickJob: vi.fn() as never,
    connected: () => Promise.resolve([]),
    emit: () => {
      emitted += 1;
    },
    now: () => clock,
    setTimer: (run) => run,
    clearTimer: () => undefined,
    draftWait: () => Promise.resolve(),
    log: () => undefined,
  });
});

afterEach(async () => {
  service.dispose();
  source.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const stateOf = async (id: string) => (await source.creatorStates()).find((c) => c.id === id);
const logTexts = async (): Promise<string[]> => (await source.frame()).log.map((l) => l.text);
const draftsOf = (id: string) =>
  source.outreach.draftsIn(allStates).filter((d) => d.creator === id);

function openDraft(
  id: string,
  creator: string,
  kind: "first" | "followUp" | "reply",
  state: DraftState,
) {
  source.outreach.insertDraft({
    id,
    creator,
    kind,
    followUp: kind === "followUp" ? 1 : null,
    mailbox: "outreach1@gratovo.example",
    replyTo: null,
    at: clock,
  });
  source.outreach.updateDraft(id, { state, subject: "a note", body: "Hi" }, clock);
}

describe("decline", () => {
  it("answers no_data, not_found and wrong_state", async () => {
    const none = createReachService({
      mode: () => null,
      source: () => null,
      gemini: { status: vi.fn() as never, call: vi.fn() as never },
      jobs: { jobContext: () => null, secrets: {} as never },
      runQuickJob: vi.fn() as never,
      connected: () => Promise.resolve([]),
      emit: () => undefined,
    });
    expect(await none.decline("c14")).toEqual({ ok: false, problem: "no_data" });
    expect(await service.decline("nobody")).toEqual({ ok: false, problem: "not_found" });
    // c1 is signed: it can't be declined.
    expect(await service.decline("c1")).toEqual({ ok: false, problem: "wrong_state" });
    expect((await stateOf("c1"))?.stage).toBe("signed");
  });

  it("rejects with the reason, skips every open draft, logs, and queues the decline draft", async () => {
    openDraft("d-first", "c14", "first", "ready");
    openDraft("d-follow", "c14", "followUp", "failed");
    const answer = await service.decline("c14");
    expect(answer).toMatchObject({ ok: true, before: "kit", skipped: ["d-first", "d-follow"] });
    const draftId = answer.ok ? answer.draftId : null;
    expect(draftId).not.toBeNull();

    const creator = await stateOf("c14");
    expect(creator?.stage).toBe("rejected");
    expect(creator?.rejectReason).toBe("audience");
    expect(source.outreach.draft("d-first")?.state).toBe("skipped");
    expect(source.outreach.draft("d-follow")?.state).toBe("skipped");
    expect(await logTexts()).toContain(
      "Declined AgentWorks: audience outside the US, UK, CA and AU",
    );

    const draft = source.outreach.draft(draftId ?? "");
    expect(draft).toMatchObject({
      creator: "c14",
      kind: "reply",
      goal: "decline",
      replyTo: "msg7",
      mailbox: "outreach1@gratovo.example",
    });
    expect(draft?.state).not.toBe("approved");
    expect(emitted).toBeGreaterThan(0);
  });

  it("queues no draft for a creator with nothing inbound", async () => {
    await source.write([
      { kind: "creator.stage", id: "c8", stage: "replied", handle: "@shipai", name: "Ship AI" },
    ]);
    const answer = await service.decline("c8");
    expect(answer).toMatchObject({ ok: true, draftId: null, before: "replied" });
    expect((await stateOf("c8"))?.stage).toBe("rejected");
  });
});

describe("undo decline", () => {
  it("puts the stage back, skips the decline draft and brings the skipped draft back as ready", async () => {
    openDraft("d-first", "c14", "first", "approved");
    const done = await service.decline("c14");
    if (!done.ok) {
      throw new Error("decline failed");
    }
    expect(source.outreach.draft("d-first")?.state).toBe("skipped");
    const undo = await service.undoDecline({
      creatorId: "c14",
      draftId: done.draftId,
      before: "kit",
      skipped: done.skipped,
    });
    expect(undo).toEqual({ ok: true });
    const creator = await stateOf("c14");
    expect(creator?.stage).toBe("kit");
    expect(creator?.rejectReason).toBeNull();
    expect(source.outreach.draft(done.draftId ?? "")?.state).toBe("skipped");
    // Never back as approved or scheduled.
    expect(source.outreach.draft("d-first")?.state).toBe("ready");
    expect(await logTexts()).toContain("Undid declining AgentWorks");
  });

  it("keeps a decline draft a person approved, and brings nothing back on top of it", async () => {
    openDraft("d-first", "c14", "first", "ready");
    const done = await service.decline("c14");
    if (!done.ok) {
      throw new Error("decline failed");
    }
    source.outreach.updateDraft(done.draftId ?? "", { state: "approved" }, clock);
    expect(
      await service.undoDecline({
        creatorId: "c14",
        draftId: done.draftId,
        before: "kit",
        skipped: done.skipped,
      }),
    ).toEqual({ ok: true });
    expect(source.outreach.draft(done.draftId ?? "")?.state).toBe("approved");
    expect(source.outreach.draft("d-first")?.state).toBe("skipped");
  });

  it("is refused once the stage moved", async () => {
    const done = await service.decline("c14");
    if (!done.ok) {
      throw new Error("decline failed");
    }
    await source.write([
      {
        kind: "creator.stage",
        id: "c14",
        stage: "parked",
        handle: "@agentworks",
        name: "AgentWorks",
      },
    ]);
    expect(
      await service.undoDecline({
        creatorId: "c14",
        draftId: done.draftId,
        before: "kit",
        skipped: [],
      }),
    ).toEqual({ ok: false, problem: "wrong_state" });
    expect((await stateOf("c14"))?.stage).toBe("parked");
  });
});

describe("ask", () => {
  it("refuses a wrong stage, nothing missing and an open draft", async () => {
    expect(await service.ask("c1")).toEqual({ ok: false, problem: "wrong_state" });
    // c14 has every number.
    expect(await service.ask("c14")).toEqual({ ok: false, problem: "nothing_missing" });
    openDraft("d-open", "c16", "reply", "ready");
    expect(await service.ask("c16")).toEqual({ ok: false, problem: "draft_open" });
    expect(await service.ask("nobody")).toEqual({ ok: false, problem: "not_found" });
  });

  it("queues an ask_kit reply draft answering the newest inbound message", async () => {
    const answer = await service.ask("c16");
    expect(answer.ok).toBe(true);
    const draft = source.outreach.draft(answer.ok ? answer.draftId : "");
    expect(draft).toMatchObject({
      creator: "c16",
      kind: "reply",
      goal: "ask_kit",
      replyTo: "msg13",
    });
    expect(draftsOf("c16")).toHaveLength(1);
    expect(await logTexts()).toContain("Asked Context Window for their missing numbers");
    expect((await stateOf("c16"))?.stage).toBe("kit");
  });
});
