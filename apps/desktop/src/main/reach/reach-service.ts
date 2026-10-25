import {
  threadMessagesMax,
  type DataSource,
  type Frame,
  type MailboxView,
} from "@gratovo/core/data";
import type { GeminiStatus } from "@gratovo/ipc";

import type { JobOutcome } from "../pipeline/jobs";
import type { GeminiParams } from "../pipeline/gemini-protocol";
import type { GeminiCall } from "../pipeline/gemini-service";
import type { Start } from "../pipeline/protocol";
import type { ReachService } from "../services";
import type { ConnectionsDeps } from "../settings/connections-service";
import { buildQuickStart } from "../settings/connections-jobs";
import { readMailRows } from "../settings/connections-store";

import { createDrafter, proposeTimeoutS, type Drafter } from "./drafter";
import { buildCommsFacts, threadIdOf } from "./facts";
import { createMailState, type MailState } from "./mail-state";
import { createQuickQueue, type QuickQueue } from "./quick-queue";
import { createSender, type CheckOutcome, type Sender, type SendOutcome } from "./sender";

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
  /** Tells the page the frame's `reach` part changed. */
  emit(): void;
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
/** How often the mailbox numbers are read again while live data is open. */
export const mailRefreshMs = 10 * 60_000;

/** A draft the rail counts: first emails and follow-ups waiting for a person, replies not done. */
function countsForRail(frame: Frame): number {
  return frame.reach.drafts.filter((draft) => {
    if (draft.kind === "reply") {
      return draft.state !== "sent" && draft.state !== "skipped";
    }
    return draft.state === "ready" || draft.state === "failed";
  }).length;
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
  function changed(): void {
    if (emitTimer !== null) {
      return;
    }
    const wait = lastEmit + changedGapMs - now();
    if (wait <= 0) {
      lastEmit = now();
      deps.emit();
      return;
    }
    emitTimer = setTimer(() => {
      emitTimer = null;
      lastEmit = now();
      deps.emit();
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
    sender,
    mailboxes: () => mailState.views(),
    changed,
    now,
    ...(deps.draftWait === undefined ? {} : { wait: deps.draftWait }),
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

  return {
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

    overlay(frame) {
      me = frame.me;
      myName = frame.myName;
      const state = drafter.state();
      const mailboxes: MailboxView[] = mailState.views();
      return {
        ...frame,
        counts: { ...frame.counts, reach: countsForRail(frame) },
        reach: {
          ...frame.reach,
          mailboxes,
          gemini: state.gemini,
          geminiPausedUntil: state.pausedUntil,
          sender: sender(),
        },
      };
    },

    afterWrite(writes) {
      if (writes.some((write) => write.kind.startsWith("draft."))) {
        theSender.afterWrite();
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
      if (deps.mode() === "live") {
        armRefreshTimer();
      }
    },
    closed() {
      drafter.drop();
      theSender.drop();
      stopRefreshTimer();
    },
    geminiChanged() {
      drafter.kick();
    },
    mailSettingsChanged() {
      void refreshAndTell();
      drafter.kick();
    },
    dispose() {
      stopRefreshTimer();
      if (emitTimer !== null) {
        clearTimer(emitTimer);
        emitTimer = null;
      }
      drafter.drop();
      theSender.drop();
    },
  };
}
