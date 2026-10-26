import { randomUUID } from "node:crypto";

import {
  exampleCountries,
  reachDraftsMax,
  threadMessagesMax,
  type CreatorState,
  type DataSource,
  type DataWrite,
  type DraftState,
  type Frame,
  type MailboxView,
  type Sequence,
} from "@gratovo/core/data";
import {
  isFinished,
  isRunning,
  parked,
  repliesToAnswer,
  replyItems,
  resumed,
  stopped,
  wakeDue,
  withStep,
  woken,
  zoneOf,
} from "@gratovo/core/reach";
import {
  sequenceRestoreMax,
  type ChannelInput,
  type ChannelResponse,
  type FramePart,
  type GeminiStatus,
} from "@gratovo/ipc";

import type { JobOutcome } from "../pipeline/jobs";
import type { GeminiParams } from "../pipeline/gemini-protocol";
import type { GeminiCall } from "../pipeline/gemini-service";
import { jobSchema, type Start } from "../pipeline/protocol";
import type { ReachService } from "../services";
import type { ConnectionsDeps } from "../settings/connections-service";
import { buildQuickStart } from "../settings/connections-jobs";
import { readMailRows, sameAddress } from "../settings/connections-store";

import { createDrafter, proposeTimeoutS, type Drafter } from "./drafter";
import { buildCommsFacts, threadIdOf } from "./facts";
import { createMailState, type MailState } from "./mail-state";
import { mailboxKey, noFlags, readMailboxFlags, writeMailboxFlags } from "./mailbox-settings";
import { createQuickQueue, type QuickQueue } from "./quick-queue";
import { createReplySweep, skipOpenFollowUps, type ReplySweep } from "./reply-sweep";
import { createSender, type CheckOutcome, type Sender, type SendOutcome } from "./sender";
import { createSituations, type Situations } from "./situations";
import { mailboxStrings, sequenceStrings } from "./strings";

/**
 * Reach in the main process (plan step 6, A6): one quick queue, the mail state, the sender and the
 * drafter, wired to the open data source, the Gemini bridge and the quick lane. It answers the
 * seven `reach:*` channels, puts the runtime parts of `reach` (mailboxes, the Gemini state, the
 * sender's name) and the rail count into the frame, and tells the page when any of it changes.
 *
 * It never starts the bridge and never sends a prompt or a mail by itself: the modules it holds
 * keep those rules. Logs carry kinds and codes only, never an address, a subject or a body.
 */
export interface ReachServiceHandle extends ReachService {
  /** A data source opened (or the app started with one): mailboxes first, then the timers. */
  opened(): Promise<void>;
  /** The data source is switching: no queue or timer survives it. */
  closed(): void;
  /** The Gemini bridge's state changed. */
  geminiChanged(): void;
  /** The mail settings (sender name, mailboxes) were saved. */
  mailSettingsChanged(): void;
  /** The day check: finish what ran out, wake what is due. Run at midnight and after a sleep. */
  dayTick(): Promise<void>;
  /** At quit: stops every timer. */
  dispose(): void;
}

export interface ReachServiceDeps {
  mode(): "example" | "live" | null;
  source(): DataSource | null;
  gemini: {
    status(): GeminiStatus | Promise<GeminiStatus>;
    call<M extends "action.comms_propose" | "action.comms_check" | "bridge.status">(
      method: M,
      params: GeminiParams<M>,
      options?: { timeoutMs?: number },
    ): Promise<GeminiCall<M>>;
  };
  /** What `buildQuickStart` needs: where a job runs and the secret store. */
  jobs: Pick<ConnectionsDeps, "jobContext" | "secrets">;
  /** Runs one job on the quick lane. */
  runQuickJob(start: Start): Promise<JobOutcome>;
  /** The addresses with a stored refresh token. */
  connected(): Promise<readonly string[]>;
  /** The reply situations of the course's playbook; none when the file is not there. */
  situations?: Situations;
  /** The country (two letters) of each channel the Find catalog knows; unknown ones are left out. */
  countries?(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Tells the page the frame's `reach` part changed, and `more` parts besides it. */
  emit(more?: readonly FramePart[]): void;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: (line: string) => void;
  /** Overrides for tests. */
  quickQueueRetryMs?: number;
  quickWait?: (ms: number) => Promise<void>;
  draftWait?: (ms: number) => Promise<void>;
}

/** The page hears of a change at most this often. */
export const changedGapMs = 250;
/** How long the example data's test email takes. */
export const exampleTestMs = 600;
/** How often the mailbox numbers are read again while live data is open. */
export const mailRefreshMs = 10 * 60_000;

/**
 * What the rail counts (D16): first emails and follow-ups waiting for a person, and the replies
 * to answer, which is the number the Replies page's sub line shows.
 */
function countsForRail(frame: Frame): number {
  const waiting = frame.reach.drafts.filter(
    (draft) => draft.kind !== "reply" && (draft.state === "ready" || draft.state === "failed"),
  ).length;
  return (
    waiting + repliesToAnswer(replyItems(frame.creators, frame.reach.threads, frame.reach.drafts))
  );
}

/** A member without money sees no rate a reply named (D14): its reading keeps the other facts. */
function withoutRates(threads: Frame["reach"]["threads"]): Frame["reach"]["threads"] {
  return threads.map((thread) =>
    thread.lastIn?.reading == null
      ? thread
      : {
          ...thread,
          lastIn: {
            ...thread.lastIn,
            reading: {
              ...thread.lastIn.reading,
              facts: thread.lastIn.reading.facts.filter((fact) => fact.key !== "rate"),
            },
          },
        },
  );
}

export function createReachService(deps: ReachServiceDeps): ReachServiceHandle {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer =
    deps.clearTimer ??
    ((handle: unknown) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  const log =
    deps.log ??
    ((line: string) => {
      console.info(line);
    });

  // The member and the profile name, as the last frame read had them (a frame read is async,
  // the drafter and the sender ask in the middle of sync code).
  let me = "";
  let myName: string | null = null;

  // --- the page is told at most once per changedGapMs ---
  let lastEmit = Number.NEGATIVE_INFINITY;
  let emitTimer: unknown = null;
  // Parts besides `reach` asked for while a send waits its turn.
  const pendingMore = new Set<FramePart>();
  function flush(): void {
    lastEmit = now();
    const more = [...pendingMore];
    pendingMore.clear();
    if (more.length === 0) {
      deps.emit();
    } else {
      deps.emit(more);
    }
  }
  function changed(more: readonly FramePart[] = []): void {
    for (const part of more) {
      pendingMore.add(part);
    }
    if (emitTimer !== null) {
      return;
    }
    const wait = lastEmit + changedGapMs - now();
    if (wait <= 0) {
      flush();
      return;
    }
    emitTimer = setTimer(() => {
      emitTimer = null;
      flush();
    }, wait);
  }

  // --- the quick lane, shared by the status and the sends ---
  const queue: QuickQueue = createQuickQueue({
    run: (start) => deps.runQuickJob(start),
    ...(deps.quickQueueRetryMs === undefined ? {} : { retryMs: deps.quickQueueRetryMs }),
    ...(deps.quickWait === undefined ? {} : { wait: deps.quickWait }),
  });

  /** Builds a start with the mail secrets and queues it; null when no live data is open. */
  async function runMail(job: Start["job"]): Promise<JobOutcome | null> {
    const source = deps.source();
    if (source === null) {
      return null;
    }
    const start = await buildQuickStart(deps.jobs, source, job, { mail: true });
    return start === null ? null : queue.enqueue(start);
  }

  const mailState: MailState = createMailState({
    mode: () => deps.mode(),
    source: () => deps.source(),
    runStatus: () => runMail({ kind: "mail.status" }),
    connected: () => deps.connected(),
    notified: () => {
      changed(["notify"]);
    },
    now,
    log,
  });

  async function bridgeReady(): Promise<boolean> {
    try {
      const status = await deps.gemini.status();
      return status.state === "listening" && status.addon.state === "connected";
    } catch {
      return false;
    }
  }

  /** When the bridge's pause ends (ms); null while prompts may go or when it can't be told. */
  async function bridgePausedUntil(): Promise<number | null> {
    const answer = await deps.gemini.call("bridge.status", {});
    if (!answer.ok) {
      return null;
    }
    const until = answer.result.pausedUntil;
    if (typeof until !== "string") {
      return null;
    }
    const at = Date.parse(until);
    return Number.isNaN(at) || at <= now() ? null : at;
  }

  const sender: () => string | null = () => {
    const name = (readMailRows(deps.source()).senderName ?? myName ?? "").trim();
    return name === "" ? null : name;
  };

  const theSender: Sender = createSender({
    mode: () => deps.mode(),
    source: () => deps.source(),
    me: () => me,
    async send(message): Promise<SendOutcome> {
      const outcome = await runMail({ kind: "mail.send", message });
      return outcome ?? { ok: false, problem: "not_started" };
    },
    async check(draftId, subject, body): Promise<CheckOutcome> {
      if (!(await bridgeReady())) {
        return { ok: false };
      }
      const source = deps.source();
      const draft = source?.outreach.draft(draftId) ?? null;
      if (source === null || draft === null) {
        return { ok: false };
      }
      try {
        const states = await source.creatorStates();
        const creator = states.find((state) => state.id === draft.creator);
        const facts = await buildCommsFacts({
          source,
          creatorId: draft.creator,
          sender: sender(),
          now: now(),
        });
        const answer = await deps.gemini.call("action.comms_check", {
          request: {
            kind: draft.kind,
            channelId: draft.creator,
            ...(creator?.email == null ? {} : { contactEmail: creator.email }),
            threadId: threadIdOf(draft.creator),
            ...(draft.followUp === null ? {} : { followUpNumber: draft.followUp }),
            timeoutS: proposeTimeoutS,
          },
          facts,
          subject,
          body,
        });
        if (!answer.ok) {
          log(`Reach: the check of an edited draft failed (${answer.error.code}).`);
          return { ok: false };
        }
        return {
          ok: true,
          blocking: answer.result.blocking,
          findings: answer.result.findings.map((finding) => ({
            rule: (finding.rule.trim() === "" || finding.rule.trim() === "-"
              ? finding.code
              : finding.rule
            ).slice(0, 50),
            text: finding.detail.slice(0, 5000),
            blocking: finding.severity === "block",
          })),
        };
      } catch {
        log("Reach: the check of an edited draft failed.");
        return { ok: false };
      }
    },
    mailboxes: () => mailState.views(),
    afterSend: () => {
      mailState.afterSend();
    },
    changed,
    now,
    ...(deps.setTimer === undefined ? {} : { setTimer: deps.setTimer }),
    ...(deps.clearTimer === undefined ? {} : { clearTimer: deps.clearTimer }),
    log,
  });

  const drafter: Drafter = createDrafter({
    mode: () => deps.mode(),
    source: () => deps.source(),
    async bridge() {
      if (!(await bridgeReady())) {
        return { ready: false, pausedUntil: null };
      }
      return { ready: true, pausedUntil: await bridgePausedUntil() };
    },
    propose: (params) => deps.gemini.call("action.comms_propose", params),
    // How an answer's reply was read is stored on the reply (D23).
    reading: (draft, proposal) => replies.reading(draft, proposal),
    sender,
    mailboxes: () => mailState.views(),
    changed,
    now,
    ...(deps.draftWait === undefined ? {} : { wait: deps.draftWait }),
  });

  // --- the replies (D23): the sweep, Paste a reply, the reading and "That's not it" ---
  const replies: ReplySweep = createReplySweep({
    mode: () => deps.mode(),
    source: () => deps.source(),
    run: (job) => runMail(job),
    connected: () => deps.connected(),
    situations: deps.situations ?? createSituations({ file: null, log }),
    reread: (draftId, label) => drafter.reread(draftId, label),
    changed,
    kick: () => {
      drafter.kick();
    },
    afterWrite: () => {
      theSender.afterWrite();
    },
    now,
    ...(deps.setTimer === undefined ? {} : { setTimer: deps.setTimer }),
    ...(deps.clearTimer === undefined ? {} : { clearTimer: deps.clearTimer }),
    log,
  });

  // --- the mailbox numbers, read again every ten minutes while live data is open ---
  let refreshTimer: unknown = null;
  function stopRefreshTimer(): void {
    if (refreshTimer !== null) {
      clearTimer(refreshTimer);
      refreshTimer = null;
    }
  }
  function armRefreshTimer(): void {
    stopRefreshTimer();
    refreshTimer = setTimer(() => {
      refreshTimer = null;
      if (deps.mode() === "live" && mailState.views().length > 0) {
        void refreshAndTell();
      }
      if (deps.mode() === "live") {
        armRefreshTimer();
      }
    }, mailRefreshMs);
  }

  async function refreshAndTell(): Promise<"ok" | "busy" | "no_mail" | "no_data"> {
    let answer: "ok" | "busy" | "no_mail" | "no_data" = "no_data";
    try {
      answer = await mailState.refresh();
    } catch {
      log("Reach: the mailbox check failed.");
    }
    changed();
    return answer;
  }

  async function readIdentity(): Promise<void> {
    const source = deps.source();
    if (source === null) {
      return;
    }
    try {
      const frame = await source.frame();
      me = frame.me;
      myName = frame.myName;
    } catch {
      log("Reach: the frame couldn't be read.");
    }
  }

  // --- the mailbox settings and the test email (D20) ---

  function setMailbox(
    request: ChannelInput<"reach:mailbox-set">,
  ): Promise<ChannelResponse<"reach:mailbox-set">> {
    const source = deps.source();
    if (source === null || deps.mode() === null) {
      return Promise.resolve({ ok: false, problem: "no_data" });
    }
    const mail = readMailRows(source);
    const row = mail.mailboxes.find((m) => sameAddress(m.address, request.address));
    if (row === undefined) {
      return Promise.resolve({ ok: false, problem: "not_found" });
    }
    const { dailyCap } = request;
    if (dailyCap !== undefined) {
      // Only the cap changes: the row keeps its warm-up date, as Settings › Connections does.
      source.writeSetting("mail.settings", {
        ...mail,
        mailboxes: mail.mailboxes.map((m) =>
          m === row ? { address: m.address, dailyCap, warmupStartedOn: m.warmupStartedOn } : m,
        ),
      });
    }
    if (request.paused !== undefined) {
      const was = readMailboxFlags(source).get(mailboxKey(row.address)) ?? noFlags;
      writeMailboxFlags(source, row.address, { ...was, paused: request.paused });
    }
    changed();
    // A paused mailbox's approved draft must be checked again before it goes.
    theSender.afterWrite();
    return Promise.resolve({ ok: true });
  }

  /** The addresses a test email is on its way from. */
  const testing = new Set<string>();

  async function sendTest(address: string): Promise<ChannelResponse<"reach:send-test">> {
    const source = deps.source();
    const mode = deps.mode();
    if (source === null || mode === null) {
      return { ok: false, problem: "no_data" };
    }
    if (me === "") {
      await readIdentity();
    }
    if (me === "") {
      return { ok: false, problem: "no_data" };
    }
    const row = readMailRows(source).mailboxes.find((m) => sameAddress(m.address, address));
    if (row === undefined) {
      return { ok: false, problem: "not_found" };
    }
    const view = mailState.views().find((v) => sameAddress(v.address, row.address));
    if (view?.paused === true) {
      return { ok: false, problem: "paused" };
    }
    if (view?.signedOut === true) {
      return { ok: false, problem: "signed_out" };
    }
    const key = mailboxKey(row.address);
    if (testing.has(key)) {
      return { ok: false, problem: "busy" };
    }
    testing.add(key);
    try {
      if (mode === "example") {
        // No job: a stand-in success after a short wait.
        await new Promise<void>((resolve) => {
          setTimer(resolve, exampleTestMs);
        });
        return { ok: true };
      }
      if (!(await deps.connected()).some((a) => sameAddress(a, row.address))) {
        return { ok: false, problem: "not_connected" };
      }
      // Sent from this click and from no other path; it is not stored as an outreach message.
      const message = {
        to: row.address,
        mailbox: row.address,
        subject: mailboxStrings.testSubject,
        body: mailboxStrings.testBody,
        newThread: true,
        sendKey: `test-${randomUUID()}`,
        approvedBy: me,
      };
      if (!jobSchema.safeParse({ kind: "mail.send", message }).success) {
        log("Reach: a test email doesn't fit the send job.");
        return { ok: false, problem: "failed" };
      }
      let outcome: JobOutcome | null = null;
      try {
        outcome = await runMail({ kind: "mail.send", message });
      } catch {
        outcome = null;
      }
      if (
        outcome?.ok === true &&
        outcome.exit.kind === "ended" &&
        outcome.exit.end.state === "done" &&
        outcome.exit.result?.kind === "mail.send"
      ) {
        return { ok: true };
      }
      // The code only: never the address, the subject or the body.
      let code = "unknown";
      if (outcome === null) {
        code = "not_started";
      } else if (!outcome.ok) {
        code = outcome.problem;
      } else if (outcome.exit.kind === "ended") {
        code = outcome.exit.end.error?.code ?? outcome.exit.end.state;
      } else {
        code = outcome.exit.reason;
      }
      log(`Reach: a test email didn't go (${code}).`);
      return { ok: false, problem: "failed" };
    } finally {
      testing.delete(key);
      if (mode === "live") {
        mailState.afterSend();
      }
    }
  }

  /** The zone of each creator with an open draft whose channel's country is known (D21). */
  async function zonesOf(frame: Frame): Promise<Record<string, string>> {
    const open = frame.reach.drafts
      .filter((d) => d.state !== "sent" && d.state !== "skipped")
      .slice(0, reachDraftsMax);
    const ids = [...new Set(open.map((d) => d.creator))];
    if (ids.length === 0) {
      return {};
    }
    let countries: ReadonlyMap<string, string> = new Map();
    if (deps.mode() === "example") {
      countries = new Map(Object.entries(exampleCountries));
    } else if (deps.countries !== undefined) {
      try {
        countries = await deps.countries(ids);
      } catch {
        log("Reach: the channels' countries couldn't be read.");
      }
    }
    const zones: Record<string, string> = {};
    for (const id of ids) {
      const country = countries.get(id);
      const zone = country === undefined ? null : zoneOf(country);
      if (zone !== null) {
        zones[id] = zone;
      }
    }
    return zones;
  }

  // --- the follow-up sequences (D22) ---

  const nameOf = (creator: CreatorState): string => creator.name ?? creator.handle;

  const logLine = (creator: CreatorState, text: string, at: number): DataWrite => ({
    kind: "log.add",
    id: randomUUID(),
    at,
    text,
    ref: creator.id,
    action: null,
    detail: null,
  });

  const stageWrite = (creator: CreatorState, stage: "emailed" | "parked"): DataWrite => ({
    kind: "creator.stage",
    id: creator.id,
    stage,
    handle: creator.handle,
    name: nameOf(creator),
  });

  type SequenceAnswer = ChannelResponse<"reach:sequence-resume">;
  type SkipAnswer = ChannelResponse<"reach:sequence-stop">;

  /** What each command needs: the open source, the creator and its sequence. */
  async function sequenceOf(
    creatorId: string,
  ): Promise<
    | { source: DataSource; creator: CreatorState; sequence: Sequence }
    | Extract<SequenceAnswer, { ok: false }>
  > {
    const source = deps.source();
    if (source === null || deps.mode() === null) {
      return { ok: false, problem: "no_data" };
    }
    const creator = (await source.creatorStates()).find((c) => c.id === creatorId) ?? null;
    // Read after the await: the sequence is what it is now, not what it was when asked.
    const sequence = source.outreach.sequence(creatorId);
    if (creator === null || sequence === null) {
      return { ok: false, problem: "not_found" };
    }
    return { source, creator, sequence };
  }

  /** The page hears of the change, and of the log line and the stage the command wrote. */
  function afterCommand(): SequenceAnswer {
    changed(["log", "creators"]);
    theSender.afterWrite();
    return { ok: true };
  }

  const localMidnight = (at: number): number => {
    const d = new Date(at);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  // How many times each creator has been woken: a Wake that waited on a read while another one
  // (a double click, or the day timer) went through finds the count moved and refuses.
  const wakes = new Map<string, number>();
  const wakesOf = (id: string): number => wakes.get(id) ?? 0;

  /**
   * An Undo of a Stop or a Park: the follow-up draft it skipped (this creator's, still skipped)
   * comes back and its step goes back to drafted. A draft with no text yet goes back to drafting,
   * any other to `ready`: approved and scheduled ones are never put back as such, so an Undo
   * can't send. At most one comes back, and none when the creator has another open draft now.
   */
  function restoreDrafts(
    source: DataSource,
    creatorId: string,
    restore: readonly string[],
    sequence: Sequence,
  ): { drafts: { id: string; patch: { state: DraftState; problem: null } }[]; sequence: Sequence } {
    const none = { drafts: [], sequence };
    if (source.outreach.openDraft(creatorId) !== null) {
      return none;
    }
    for (const id of restore.slice(0, sequenceRestoreMax)) {
      const draft = source.outreach.draft(id);
      if (
        draft === null ||
        draft.creator !== creatorId ||
        draft.kind !== "followUp" ||
        draft.followUp === null ||
        draft.state !== "skipped"
      ) {
        continue;
      }
      const step = sequence.steps.find((x) => x.n === draft.followUp);
      if (step?.state !== "planned") {
        continue;
      }
      return {
        drafts: [{ id, patch: { state: draft.body === "" ? "drafting" : "ready", problem: null } }],
        sequence: withStep(sequence, draft.followUp, "drafted"),
      };
    }
    return none;
  }

  async function stopSequence(creatorId: string): Promise<SkipAnswer> {
    const found = await sequenceOf(creatorId);
    if (!("source" in found)) {
      return found;
    }
    const { source, creator, sequence } = found;
    if (sequence.stopped !== null) {
      return { ok: false, problem: "wrong_state" };
    }
    const at = now();
    const skip = skipOpenFollowUps(source, creatorId);
    source.outreach.commit({
      at,
      drafts: skip,
      sequences: [stopped(sequence)],
      writes: [logLine(creator, sequenceStrings.stopped(nameOf(creator)), at)],
    });
    afterCommand();
    return { ok: true, skipped: skip.map((d) => d.id).slice(0, sequenceRestoreMax) };
  }

  async function resumeSequence(
    creatorId: string,
    restore?: readonly string[],
  ): Promise<SequenceAnswer> {
    const found = await sequenceOf(creatorId);
    if (!("source" in found)) {
      return found;
    }
    const { source, creator, sequence } = found;
    if (sequence.stopped !== "you") {
      return { ok: false, problem: "wrong_state" };
    }
    const at = now();
    // An Undo brings back what the Stop skipped as it was; the steps are not re-timed then.
    const back =
      restore === undefined
        ? { drafts: [], sequence: resumed(sequence, at) }
        : restoreDrafts(source, creatorId, restore, resumed(sequence, null));
    source.outreach.commit({
      at,
      drafts: back.drafts,
      sequences: [back.sequence],
      writes: [logLine(creator, sequenceStrings.resumed(nameOf(creator)), at)],
    });
    drafter.kick();
    return afterCommand();
  }

  async function parkCreator(creatorId: string, until: number): Promise<SkipAnswer> {
    const found = await sequenceOf(creatorId);
    if (!("source" in found)) {
      return found;
    }
    const { source, creator, sequence } = found;
    const at = now();
    if (
      !Number.isFinite(until) ||
      creator.stage !== "emailed" ||
      !isRunning(sequence) ||
      localMidnight(until) <= localMidnight(at)
    ) {
      return { ok: false, problem: "wrong_state" };
    }
    const next = parked(sequence, until);
    const skip = skipOpenFollowUps(source, creatorId);
    source.outreach.commit({
      at,
      drafts: skip,
      sequences: [next],
      writes: [
        stageWrite(creator, "parked"),
        logLine(creator, sequenceStrings.parked(nameOf(creator), next.parkUntil ?? until), at),
      ],
    });
    afterCommand();
    return { ok: true, skipped: skip.map((d) => d.id).slice(0, sequenceRestoreMax) };
  }

  async function wakeCreator(
    creatorId: string,
    restore?: readonly string[],
  ): Promise<SequenceAnswer> {
    const before = wakesOf(creatorId);
    const found = await sequenceOf(creatorId);
    if (!("source" in found)) {
      return found;
    }
    const { source, creator, sequence } = found;
    // The stage and the date can drift apart: either one says it is parked. A wake that went
    // through while this one waited on its read leaves nothing to wake.
    if (
      wakesOf(creatorId) !== before ||
      (creator.stage !== "parked" && sequence.parkUntil === null)
    ) {
      return { ok: false, problem: "wrong_state" };
    }
    const at = now();
    const back =
      restore === undefined
        ? { drafts: [], sequence: woken(sequence, at) }
        : restoreDrafts(source, creatorId, restore, woken(sequence, null));
    wakes.set(creatorId, before + 1);
    source.outreach.commit({
      at,
      drafts: back.drafts,
      sequences: [back.sequence],
      writes: [
        ...(creator.stage === "parked" ? [stageWrite(creator, "emailed")] : []),
        logLine(creator, sequenceStrings.woke(nameOf(creator)), at),
      ],
    });
    drafter.kick();
    return afterCommand();
  }

  // --- the day timer: at start and at each local midnight ---
  let dayTimer: unknown = null;

  function stopDayTimer(): void {
    if (dayTimer !== null) {
      clearTimer(dayTimer);
      dayTimer = null;
    }
  }

  function armDayTimer(): void {
    stopDayTimer();
    const at = now();
    const next = new Date(at);
    next.setHours(24, 0, 0, 0);
    dayTimer = setTimer(
      () => {
        dayTimer = null;
        void dayTick();
        armDayTimer();
      },
      Math.max(1000, next.getTime() - at),
    );
  }

  /** Finishes the sequences that ran out and wakes the parked creators whose day came. */
  async function dayTick(): Promise<void> {
    const source = deps.source();
    if (source === null || deps.mode() === null) {
      return;
    }
    let wrote = false;
    try {
      const at = now();
      const states = await source.creatorStates();
      if (deps.source() !== source) {
        return;
      }
      // The sequences as they are after the await, not before it.
      for (const sequence of source.outreach.runningSequences()) {
        const creator = states.find((c) => c.id === sequence.creator);
        // A creator now never contact is left alone: no wake, no line.
        if (creator === undefined || creator.stage === "never") {
          continue;
        }
        if (wakeDue(sequence, at)) {
          wakes.set(creator.id, wakesOf(creator.id) + 1);
          source.outreach.commit({
            at,
            sequences: [woken(sequence, at)],
            writes: [
              ...(creator.stage === "parked" ? [stageWrite(creator, "emailed")] : []),
              logLine(creator, sequenceStrings.woke(nameOf(creator)), at),
            ],
          });
          wrote = true;
        } else if (sequence.parkUntil === null && isFinished(sequence, at)) {
          source.outreach.commit({
            at,
            sequences: [{ ...sequence, stopped: "finished" }],
            writes: [logLine(creator, sequenceStrings.finished(nameOf(creator)), at)],
          });
          wrote = true;
        }
      }
    } catch {
      log("Reach: the day's sequence check failed.");
    }
    changed(wrote ? ["log", "creators"] : []);
    drafter.kick();
  }

  return {
    sequenceStop: stopSequence,
    sequenceResume: resumeSequence,
    park: parkCreator,
    wake: wakeCreator,
    async dayTick() {
      // After a sleep the timer may have been late or lost: run the check and set it again.
      if (deps.source() === null || deps.mode() === null) {
        return;
      }
      armDayTimer();
      await dayTick();
    },

    thread(creatorId) {
      const source = deps.source();
      if (source === null || deps.mode() === null) {
        return Promise.resolve({ ok: false, problem: "no_data" });
      }
      return Promise.resolve({
        ok: true,
        messages: source.outreach.thread(creatorId, threadMessagesMax),
      });
    },
    draftNow: (creatorId) => drafter.draftNow(creatorId),
    rewrite: (draftId, how) => drafter.rewrite(draftId, how),
    retry: (draftId) => drafter.retry(draftId),
    markSent: (draftId) => theSender.markSent(draftId),
    sendNew: (draftId) => theSender.sendNew(draftId),
    async refreshMailboxes() {
      const answer = await refreshAndTell();
      return answer === "ok" ? { ok: true } : { ok: false, problem: answer };
    },

    setMailbox,
    sendTest,

    checkReplies: () => replies.check(),
    pasteReply: (creatorId, text) => replies.paste(creatorId, text),
    reclassify: (messageId, replyType) => replies.reclassify(messageId, replyType),
    situations: () => replies.situations(),

    async overlay(frame) {
      me = frame.me;
      myName = frame.myName;
      const state = drafter.state();
      const mailboxes: MailboxView[] = mailState.views();
      const zones = await zonesOf(frame);
      return {
        ...frame,
        counts: { ...frame.counts, reach: countsForRail(frame) },
        reach: {
          ...frame.reach,
          threads: frame.seesMoney ? frame.reach.threads : withoutRates(frame.reach.threads),
          mailboxes,
          gemini: state.gemini,
          geminiPausedUntil: state.pausedUntil,
          sender: sender(),
          zones,
        },
      };
    },

    afterWrite(writes) {
      if (writes.some((write) => write.kind.startsWith("draft."))) {
        theSender.afterWrite();
        // A write main ignored (an Undo after the send started) must reach the page as main has
        // it, so it shows the draft going rather than `ready` (D5; review of 6a, finding 5).
        changed();
      }
      if (
        writes.some((write) => write.kind === "creator.stage" || write.kind === "creator.contact")
      ) {
        drafter.kick();
      }
    },

    async opened() {
      await readIdentity();
      // The mailboxes first: live views read the stored tokens only during a refresh, so a sender
      // started before it would send due drafts back to `ready` (no mailbox connected).
      await refreshAndTell();
      theSender.start();
      drafter.kick();
      void dayTick();
      armDayTimer();
      if (deps.mode() === "live") {
        armRefreshTimer();
        replies.start();
      }
    },
    closed() {
      drafter.drop();
      theSender.drop();
      replies.stop();
      stopRefreshTimer();
      stopDayTimer();
    },
    geminiChanged() {
      drafter.kick();
    },
    mailSettingsChanged() {
      void refreshAndTell();
      drafter.kick();
    },
    dispose() {
      replies.stop();
      stopRefreshTimer();
      stopDayTimer();
      if (emitTimer !== null) {
        clearTimer(emitTimer);
        emitTimer = null;
      }
      drafter.drop();
      theSender.drop();
    },
  };
}
