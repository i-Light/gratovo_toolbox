import { randomUUID } from "node:crypto";

import {
  draftBodyMax,
  draftFindingsMax,
  draftGatesMax,
  draftRulesMax,
  draftSubjectMax,
  engineGateKinds,
  type CreatorState,
  type DraftFinding,
  type DraftKind,
  type DraftPatch,
  type DraftProblem,
  type DraftProposal,
  type DraftSituation,
  type EngineGate,
  type EngineGateKind,
  type MailboxView,
  type ReachGeminiState,
  type RewriteHow,
  type StoredDraft,
} from "@gratovo/core/data";
import { dueSteps, pickMailbox, readReplyFacts, withStep } from "@gratovo/core/reach";
import type { ChannelResponse } from "@gratovo/ipc";

import type { GeminiParams, GeminiResult } from "../pipeline/gemini-protocol";
import type { GeminiCall, GeminiCallError } from "../pipeline/gemini-service";

import { buildCommsFacts, threadIdOf, type FactsSource } from "./facts";
import { reachStrings } from "./strings";

/**
 * Reach's drafter (plan step 6, D6 and D8): one queue, one Gemini call at a time. It writes a
 * first email for each creator at `contact` with a confirmed address and nothing sent yet, and
 * the four rewrites a person asks for. Every answer waits for a person: the drafter only ever
 * leaves a draft `drafting`, `ready`, `failed` or `skipped`, never `approved`.
 *
 * It never starts the bridge (ADR 0016 D7). Bridge off, paused or no sender: the rows stay
 * `drafting` with the reason, and the queue waits for the next kick. The owner's pacing (60 s
 * between sends, one fresh chat per prompt, the pause) is the bridge's own (D6a).
 *
 * The example data never calls Gemini: a stand-in fills the draft after 0.9 s.
 */
export interface Drafter {
  /** A frame change of creators, a start, the bridge turning ready: looks again, 2 s later. */
  kick(): void;
  /** `reach:draft-now`: queues a first email for one creator now. */
  draftNow(creatorId: string): Promise<ChannelResponse<"reach:draft-now">>;
  /** `reach:rewrite`: the new text arrives through `changed()`. */
  rewrite(draftId: string, how: RewriteHow): Promise<ChannelResponse<"reach:rewrite">>;
  /**
   * "That's not it" (D23): writes an open answer draft again with the steer note "Read their reply
   * as: <label>". It shares the rewrite's answers and its Undo.
   */
  reread(draftId: string, label: string): Promise<ChannelResponse<"reach:rewrite">>;
  /** `reach:retry`: a draft whose drafting failed goes back in the queue. */
  retry(draftId: string): Promise<ChannelResponse<"reach:retry">>;
  /** Whether drafts can be written now, as the frame's `reach.gemini` says it. */
  state(): { gemini: ReachGeminiState; pausedUntil: number | null };
  /** The data source is switching: forgets the queue and its timers; rows stay `drafting`. */
  drop(): void;
  /** Resolves once nothing is queued, waiting or being written. For tests and shutdown. */
  idle(): Promise<void>;
}

/** What the drafter needs of the open source. */
export type DrafterSource = FactsSource;

export interface DrafterDeps {
  /** The open data: the example data, live data, or null when none is open. */
  mode(): "example" | "live" | null;
  source(): DrafterSource | null;
  /**
   * Whether the bridge is listening with the add-on connected, and when its pause ends (ms).
   * It must never start the bridge.
   */
  bridge(): Promise<{ ready: boolean; pausedUntil: number | null }>;
  /** The bridge's `action.comms_propose`. */
  propose(
    params: GeminiParams<"action.comms_propose">,
  ): Promise<GeminiCall<"action.comms_propose">>;
  /**
   * An answer draft's proposal says how the reply was read (D23): stores the reading on the
   * reply, and says whether it is a bounce (then no answer is written). Never throws into the queue.
   */
  reading?(draft: StoredDraft, proposal: DraftProposal): Promise<{ bounce: boolean }>;
  /** The name drafts are signed with; null blocks drafting. */
  sender(): string | null;
  mailboxes(): readonly MailboxView[];
  /** Tells the page the frame's `reach` changed. */
  changed(): void;
  now?: () => number;
  /** Waits `ms`; a timer unless a test names another. */
  wait?: (ms: number) => Promise<void>;
  newId?: () => string;
}

/** The debounce of `kick()`. */
export const kickDelayMs = 2000;
/** How long the example stand-ins take, so the page's waiting state shows. */
export const standInMs = 900;
/** The engine's own time for one proposal, in seconds (the bridge adds its pacing). */
export const proposeTimeoutS = 240;
/** A pause the bridge reported without a time: its own length (D6a). */
const pauseFallbackMs = 30 * 60_000;

/**
 * The codes that mean the bridge could not be asked at all: no bridge, no add-on, no tab, no
 * browser. The draft stays `drafting` and waits for the bridge. A `TIMEOUT` is not one of them: the
 * prompt may have gone, so it fails and waits for Try again.
 */
const bridgeOffCodes: ReadonlySet<GeminiCallError["code"]> = new Set([
  "NOT_RUNNING",
  "EXTENSION_NOT_CONNECTED",
  "NO_TAB",
  "WORKER_RESTARTED",
  "BROWSER_NOT_FOUND",
  "BROWSER_LAUNCH_FAILED",
]);

/** The queue's order (D6): replies, then follow-ups, then first emails; oldest first in each. */
const kindRank: Record<DraftKind, number> = { reply: 0, followUp: 1, first: 2 };

/** Retry is for a draft whose drafting failed, never for a failed send. */
const draftingProblems: ReadonlySet<DraftProblem | null> = new Set([
  "engine_failed",
  "engine_blocked",
  null,
]);

type Proposal = GeminiResult<"action.comms_propose">;

/** What one engine answer comes to. */
type Mapped =
  | {
      readonly ok: true;
      readonly subject: string;
      readonly body: string;
      readonly proposal: DraftProposal;
    }
  | {
      readonly ok: false;
      readonly problem: "engine_blocked" | "engine_failed";
      readonly proposal: DraftProposal | null;
    };

/** What one call came to. */
type Outcome =
  | Mapped
  | { readonly ok: false; readonly problem: "paused" | "bridge_off"; readonly proposal: null };

const timer = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : "";

const strOrNull = (value: unknown, max: number): string | null =>
  typeof value === "string" && value !== "" ? value.slice(0, max) : null;

function mapFindings(findings: Proposal["findings"]): DraftFinding[] {
  return findings.slice(0, draftFindingsMax).map((finding) => {
    const rule = finding.rule.trim();
    return {
      rule: (rule === "" || rule === "-" ? finding.code : rule).slice(0, 50),
      text: finding.detail.slice(0, 5000),
      blocking: finding.severity === "block",
    };
  });
}

/** The engine's gates (`needs_human` plus what its checks saw); keyed by kind and place. */
function mapGates(gates: Proposal["gates"]): EngineGate[] {
  return gates.slice(0, draftGatesMax).map((gate, index) => {
    const what = gate.what;
    const kind: EngineGateKind = engineGateKinds.includes(what as EngineGateKind)
      ? (what as EngineGateKind)
      : "other";
    return { key: `${kind}-${String(index)}`, kind, text: str(gate.detail, 5000) };
  });
}

function mapSituation(value: unknown): DraftSituation | null {
  const situation = record(value);
  if (situation === null) {
    return null;
  }
  return {
    side: str(situation.side, 50),
    stage: str(situation.stage, 50),
    replyType: strOrNull(situation.reply_type, 100),
    summary: str(situation.summary, 5000),
  };
}

/** One engine answer as a draft (D6). */
export function mapProposal(result: Proposal): Mapped {
  const data = record(result.proposal);
  const decision = record(data?.decision);
  const rules = Array.isArray(decision?.rules) ? decision.rules : [];
  const proposal: DraftProposal = {
    status: result.status,
    why: str(decision?.why, 5000),
    rules: rules
      .filter(
        (rule): rule is string => typeof rule === "string" && rule !== "" && rule.length <= 50,
      )
      .slice(0, draftRulesMax),
    findings: mapFindings(result.findings),
    gates: mapGates(result.gates),
    situation: mapSituation(data?.situation),
    model: strOrNull(result.model, 100),
  };
  if (result.status === "no_message") {
    return { ok: false, problem: "engine_blocked", proposal };
  }
  const message = record(data?.message);
  const subject = str(message?.subject, draftSubjectMax);
  const body = typeof message?.body === "string" ? message.body : "";
  if (body.length > draftBodyMax) {
    return { ok: false, problem: "engine_failed", proposal: null };
  }
  // A blocked answer is shown, to be edited and checked again (its gate holds Send); any other
  // answer without a message has nothing for a person to approve.
  if (body.trim() === "" && result.status !== "blocked") {
    return { ok: false, problem: "engine_blocked", proposal };
  }
  return { ok: true, subject, body, proposal };
}

/** What the example data's stand-ins say the engine decided. */
export function standInProposal(): DraftProposal {
  return {
    status: "ready",
    why: reachStrings.standIn.why,
    rules: [...reachStrings.standIn.rules],
    findings: [],
    gates: [],
    situation: null,
    model: null,
  };
}

/** The example data's first email, from the creator's name and contact name. */
export function standInDraft(
  creator: Pick<CreatorState, "name" | "handle" | "contactName">,
  sender: string,
): { subject: string; body: string; proposal: DraftProposal } {
  const text = reachStrings.standIn;
  const body = [
    text.greeting(creator.contactName),
    ...text.paragraphs(creator.name ?? creator.handle),
    sender,
  ].join("\n\n");
  return { subject: text.subject, body, proposal: standInProposal() };
}

/** The situation the example data's stand-in reads a reply as, from its words (D23). */
export function standInSituation(body: string): string {
  if (
    /mailer-daemon|undeliverable|delivery status|address not found|couldn't be delivered/i.test(
      body,
    )
  ) {
    return "any.bounce";
  }
  if (/not interested|no thanks|no, thank|unsubscribe|please stop/i.test(body)) {
    return "inf.not_interested";
  }
  if (readReplyFacts(body).some((fact) => fact.key === "rate")) {
    return "inf.gives_rate";
  }
  if (/\b(?:manager|agency|agent)\b/i.test(body)) {
    return "inf.has_manager";
  }
  if (/\b(?:busy|later|next month|next week)\b/i.test(body)) {
    return "inf.later";
  }
  return "inf.interested_vague";
}

/** The example data's answer to a reply, and the reading its proposal carries (D23). */
export function standInReply(
  creator: Pick<CreatorState, "contactName">,
  sender: string,
  message: { readonly subject: string; readonly body: string },
  replyType: string | null = null,
): { subject: string; body: string; proposal: DraftProposal } {
  const text = reachStrings.standInReply;
  const type = replyType ?? standInSituation(message.body);
  const lines = text.answers[type] ?? text.otherAnswer;
  return {
    subject: text.subject(message.subject),
    body: [text.greeting(creator.contactName), ...lines, sender].join("\n\n"),
    proposal: {
      status: "ready",
      why: text.why,
      rules: [...text.rules],
      findings: [],
      gates: [],
      situation: {
        side: type.startsWith("brd.") ? "brand" : type.startsWith("any.") ? "any" : "influencer",
        stage: "replied",
        replyType: type,
        summary: text.summaries[type] ?? text.other,
      },
      model: null,
    },
  };
}

/** A body cut into its greeting, its paragraphs and its sign-off. */
function bodyParts(body: string): { head: string | null; middle: string[]; tail: string | null } {
  const blocks = body.split(/\n{2,}/);
  const head =
    blocks.length > 2 && /^(hi|hey|hello|dear)\b[^\n]*,$/i.test(blocks[0] ?? "")
      ? (blocks.shift() ?? null)
      : null;
  const tail = blocks.length > 1 ? (blocks.pop() ?? null) : null;
  return { head, middle: blocks, tail };
}

/** The example data's rewrites (D8): a deterministic edit of the text. */
export function standInRewrite(body: string, how: RewriteHow): string {
  const { head, middle, tail } = bodyParts(body);
  const lines = (paragraph: string | undefined): string[] => (paragraph ?? "").split("\n");
  let next = middle;
  switch (how) {
    case "shorter":
      next = middle.length > 2 ? [middle[0] ?? "", middle[middle.length - 1] ?? ""] : middle;
      break;
    case "warmer":
      next = [
        [reachStrings.standInRewrite.warmerLine, ...lines(middle[0])].join("\n"),
        ...middle.slice(1),
      ];
      break;
    case "direct": {
      const first = lines(middle[0]);
      next =
        first.length > 1
          ? [first.slice(1).join("\n"), ...middle.slice(1)]
          : middle.length > 1
            ? middle.slice(1)
            : middle;
      break;
    }
    case "redo": {
      const at = middle.length > 1 ? 1 : 0;
      next = middle.map((paragraph, index) =>
        index === at
          ? [reachStrings.standInRewrite.redoLine, ...lines(paragraph).slice(1)].join("\n")
          : paragraph,
      );
      break;
    }
  }
  return [head, ...next, tail].filter((part): part is string => part !== null).join("\n\n");
}

/** The ms of the bridge's `details.until` (ISO 8601), or null. */
function pausedUntilOf(error: GeminiCallError): number | null {
  const until = error.details.until;
  if (typeof until !== "string") {
    return null;
  }
  const at = Date.parse(until);
  return Number.isNaN(at) ? null : at;
}

const byQueueOrder = (a: StoredDraft, b: StoredDraft): number =>
  kindRank[a.kind] - kindRank[b.kind] || a.createdAt - b.createdAt;

export function createDrafter(deps: DrafterDeps): Drafter {
  const wait = deps.wait ?? timer;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;

  /** Bumped by `drop()`: anything from an older generation writes nothing. */
  let generation = 0;
  let kickToken = 0;
  /** The generation whose loop runs now, or null. */
  let looping: number | null = null;
  let again = false;
  /** The drafts with a call queued or running. */
  let inFlight = new Set<string>();
  /** One Gemini call at a time, the queue's and the rewrites'. */
  let lane: Promise<unknown> = Promise.resolve();
  const pending = new Set<Promise<unknown>>();
  /** The last check found the bridge not ready; off until the first check has looked. */
  let bridgeOff = true;
  let pausedUntil: number | null = null;
  let resumeAt: number | null = null;

  const track = (work: Promise<unknown>): void => {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
  };

  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = lane.then(work, work);
    lane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const paused = (): boolean => pausedUntil !== null && pausedUntil > now();
  /** Read through a call: `pass()` may set it while the loop awaits. */
  const askedAgain = (): boolean => again;

  function state(): { gemini: ReachGeminiState; pausedUntil: number | null } {
    if (deps.sender() === null) {
      return { gemini: "no_sender", pausedUntil: null };
    }
    if (paused()) {
      return { gemini: "paused", pausedUntil };
    }
    // Example data never asks Gemini: its stand-in is always there.
    if (deps.mode() === "example") {
      return { gemini: "ready", pausedUntil: null };
    }
    return { gemini: bridgeOff ? "off" : "ready", pausedUntil: null };
  }

  const stateKey = (): string => JSON.stringify(state());

  /** Asks the bridge how it is; tells the page when that changed what drafting can do. */
  async function checkBridge(): Promise<{ ready: boolean; paused: boolean }> {
    const before = stateKey();
    let answer: { ready: boolean; pausedUntil: number | null };
    try {
      answer = await deps.bridge();
    } catch {
      answer = { ready: false, pausedUntil: null };
    }
    bridgeOff = !answer.ready;
    pausedUntil = answer.pausedUntil;
    if (stateKey() !== before) {
      deps.changed();
    }
    return { ready: answer.ready, paused: paused() };
  }

  /** Once the pause ends: tell the page, and work the queue again. */
  function scheduleResume(): void {
    const until = pausedUntil;
    if (until === null || resumeAt === until) {
      return;
    }
    resumeAt = until;
    const mine = generation;
    void wait(Math.max(0, until - now())).then(() => {
      if (mine !== generation || resumeAt !== until) {
        return;
      }
      resumeAt = null;
      deps.changed();
      work();
    });
  }

  /** Sets a waiting reason on the rows that don't carry it yet. */
  function mark(source: DrafterSource, rows: readonly StoredDraft[], problem: DraftProblem): void {
    let any = false;
    for (const row of rows) {
      if (row.problem !== problem) {
        any = source.outreach.updateDraft(row.id, { problem }, now()) || any;
      }
    }
    if (any) {
      deps.changed();
    }
  }

  function requestFor(
    draft: StoredDraft,
    creator: CreatorState,
    note: string | null,
  ): GeminiParams<"action.comms_propose">["request"] {
    return {
      kind: draft.kind,
      channelId: draft.creator,
      ...(creator.email === null ? {} : { contactEmail: creator.email }),
      threadId: threadIdOf(draft.creator),
      ...(draft.followUp === null ? {} : { followUpNumber: draft.followUp }),
      ...(note === null ? {} : { steer: { note } }),
      timeoutS: proposeTimeoutS,
    };
  }

  /**
   * A person's correction ("That's not it") steers every later proposal for the answer: its note
   * joins whatever note the call has (a rewrite's, or none), unless it is that note already.
   */
  function withCorrection(
    source: DrafterSource,
    draft: StoredDraft,
    note: string | null,
  ): string | null {
    const reading =
      draft.kind === "reply" && draft.replyTo !== null
        ? source.outreach.message(draft.replyTo)?.reading
        : null;
    if (reading?.corrected !== true) {
      return note;
    }
    const steer = reachStrings.readAs(reading.label);
    return note === null || note === steer ? steer : `${note} ${steer}`;
  }

  /** One call to the engine, its answer mapped. Logs the code only, never text. */
  async function ask(
    source: DrafterSource,
    draft: StoredDraft,
    creator: CreatorState,
    sender: string,
    note: string | null,
  ): Promise<Outcome> {
    let call: GeminiCall<"action.comms_propose">;
    try {
      const facts = await buildCommsFacts({ source, creatorId: draft.creator, sender, now: now() });
      call = await deps.propose({
        request: requestFor(draft, creator, withCorrection(source, draft, note)),
        facts,
      });
    } catch {
      console.error("Reach: drafting failed.");
      return { ok: false, problem: "engine_failed", proposal: null };
    }
    if (call.ok) {
      bridgeOff = false;
      return mapProposal(call.result);
    }
    const code = call.error.code;
    console.error(`Reach: drafting failed (${code}).`);
    if (code === "PAUSED") {
      pausedUntil = pausedUntilOf(call.error) ?? now() + pauseFallbackMs;
      return { ok: false, problem: "paused", proposal: null };
    }
    if (bridgeOffCodes.has(code)) {
      bridgeOff = true;
      return { ok: false, problem: "bridge_off", proposal: null };
    }
    return { ok: false, problem: "engine_failed", proposal: null };
  }

  async function creatorOf(source: DrafterSource, id: string): Promise<CreatorState | null> {
    const states = await source.creatorStates();
    return states.find((state) => state.id === id) ?? null;
  }

  /** Stores how an answer's reply was read; true when it was a bounce (D23). */
  async function bounceRead(draft: StoredDraft, proposal: DraftProposal | null): Promise<boolean> {
    if (deps.reading === undefined || draft.kind !== "reply" || proposal?.situation == null) {
      return false;
    }
    try {
      return (await deps.reading(draft, proposal)).bounce;
    } catch {
      console.error("Reach: storing the reading of a reply failed.");
      return false;
    }
  }

  /** Drafts one row; "stop" ends this pass of the queue. */
  async function draftOne(
    mine: number,
    mode: "example" | "live",
    source: DrafterSource,
    row: StoredDraft,
    sender: string,
  ): Promise<"next" | "stop"> {
    const creator = await creatorOf(source, row.creator);
    if (mine !== generation) {
      return "stop";
    }
    if (source.outreach.draft(row.id)?.state !== "drafting") {
      return "next";
    }
    if (creator === null || creator.stage === "never") {
      source.outreach.updateDraft(row.id, { state: "skipped", problem: null }, now());
      deps.changed();
      return "next";
    }
    if (mode === "example") {
      await wait(standInMs);
      if (mine !== generation || source.outreach.draft(row.id)?.state !== "drafting") {
        return mine === generation ? "next" : "stop";
      }
      const replied =
        row.kind === "reply" && row.replyTo !== null ? source.outreach.message(row.replyTo) : null;
      const filled =
        row.kind === "reply"
          ? standInReply(creator, sender, replied ?? { subject: "", body: "" })
          : standInDraft(creator, sender);
      const bounce = await bounceRead(row, filled.proposal);
      if (mine !== generation || source.outreach.draft(row.id)?.state !== "drafting") {
        return mine === generation ? "next" : "stop";
      }
      // A bounce has nobody to answer: the draft is set aside, as a person's Skip would.
      source.outreach.updateDraft(
        row.id,
        bounce
          ? { state: "skipped", problem: null, proposal: filled.proposal }
          : { state: "ready", ...filled, problem: null, edited: false },
        now(),
      );
      deps.changed();
      return "next";
    }
    const outcome = await ask(source, row, creator, sender, null);
    if (mine !== generation) {
      return "stop";
    }
    if (source.outreach.draft(row.id)?.state !== "drafting") {
      return "next";
    }
    const bounce = await bounceRead(row, outcome.proposal);
    if (mine !== generation) {
      return "stop";
    }
    if (source.outreach.draft(row.id)?.state !== "drafting") {
      return "next";
    }
    let patch: DraftPatch;
    let result: "next" | "stop" = "next";
    if (bounce) {
      patch = { state: "skipped", problem: null, proposal: outcome.proposal };
    } else if (outcome.ok) {
      patch = {
        state: "ready",
        subject: outcome.subject,
        body: outcome.body,
        proposal: outcome.proposal,
        problem: null,
        edited: false,
      };
    } else if (outcome.problem === "paused" || outcome.problem === "bridge_off") {
      patch = { problem: outcome.problem };
      result = "stop";
      if (outcome.problem === "paused") {
        scheduleResume();
      }
    } else {
      patch = { state: "failed", problem: outcome.problem, proposal: outcome.proposal };
    }
    source.outreach.updateDraft(row.id, patch, now());
    deps.changed();
    return result;
  }

  /** Works the queue until it is empty or has to wait. */
  async function pass(mine: number): Promise<void> {
    for (;;) {
      const mode = deps.mode();
      const source = deps.source();
      if (mine !== generation || mode === null || source === null) {
        return;
      }
      const rows = source.outreach
        .draftsIn(["drafting"])
        .filter((row) => !inFlight.has(row.id))
        .sort(byQueueOrder);
      const row = rows[0];
      if (row === undefined) {
        // Nothing to write, but the page's "Gemini is off" banner must still be true: a status
        // call, never a prompt.
        if (mode === "live") {
          await checkBridge();
        }
        return;
      }
      const sender = deps.sender();
      if (sender === null) {
        mark(source, rows, "no_sender");
        return;
      }
      if (mode === "live") {
        const bridge = await checkBridge();
        if (mine !== generation) {
          return;
        }
        if (!bridge.ready) {
          mark(source, rows, "bridge_off");
          return;
        }
        if (bridge.paused) {
          mark(source, rows, "paused");
          scheduleResume();
          return;
        }
      }
      const flying = inFlight;
      flying.add(row.id);
      let step: "next" | "stop";
      try {
        step = await exclusive(() => draftOne(mine, mode, source, row, sender));
      } finally {
        flying.delete(row.id);
      }
      if (step === "stop") {
        // The bridge went off or paused under this row: the rest wait for the same reason.
        if (mine === generation) {
          const rest = source.outreach.draftsIn(["drafting"]);
          if (paused()) {
            mark(source, rest, "paused");
          } else if (bridgeOff) {
            mark(source, rest, "bridge_off");
          }
        }
        return;
      }
    }
  }

  function work(): void {
    if (looping === generation) {
      again = true;
      return;
    }
    const mine = generation;
    looping = mine;
    track(
      (async () => {
        try {
          do {
            again = false;
            await pass(mine);
          } while (askedAgain() && mine === generation);
        } catch {
          console.error("Reach: the drafting queue failed.");
        } finally {
          if (looping === mine) {
            looping = null;
          }
        }
      })(),
    );
  }

  /** Whether a creator is due a first email (D6). */
  function due(source: DrafterSource, creator: CreatorState): boolean {
    return (
      creator.stage === "contact" &&
      creator.emailConfirmed &&
      creator.email !== null &&
      creator.email !== "" &&
      source.outreach.openDraft(creator.id) === null &&
      source.outreach.sequence(creator.id) === null &&
      !source.outreach.hasOutbound(creator.id, false)
    );
  }

  /** Makes the first-email rows due, and skips the open drafts of creators now never contact. */
  async function scan(mine: number): Promise<void> {
    const source = deps.source();
    if (deps.mode() === null || source === null) {
      return;
    }
    const states = await source.creatorStates();
    if (mine !== generation) {
      return;
    }
    const never = new Set(states.filter((s) => s.stage === "never").map((s) => s.id));
    let any = false;
    const at = now();
    for (const draft of source.outreach.draftsIn([
      "drafting",
      "ready",
      "failed",
      "approved",
      "scheduled",
    ])) {
      if (never.has(draft.creator) && !inFlight.has(draft.id)) {
        any = source.outreach.updateDraft(draft.id, { state: "skipped", problem: null }, at) || any;
        // A skipped follow-up leaves its step skipped too, so the sequence can finish.
        const sequence = source.outreach.sequence(draft.creator);
        if (draft.kind === "followUp" && draft.followUp !== null && sequence !== null) {
          source.outreach.commit({
            at,
            sequences: [withStep(sequence, draft.followUp, "skipped")],
          });
        }
      }
    }
    const mailbox = pickMailbox(deps.mailboxes());
    for (const creator of states) {
      if (due(source, creator)) {
        source.outreach.insertDraft({
          id: newId(),
          creator: creator.id,
          kind: "first",
          followUp: null,
          mailbox,
          replyTo: null,
          at,
        });
        any = true;
      }
    }
    // The follow-ups (D22): the lowest due step of each emailed creator with no open draft. The
    // step becomes drafted in the same commit as its draft's row. Only ever drafted: nothing here
    // approves or schedules a draft.
    for (const creator of states) {
      if (creator.stage !== "emailed" || source.outreach.openDraft(creator.id) !== null) {
        continue;
      }
      const sequence = source.outreach.sequence(creator.id);
      const step = sequence === null ? undefined : dueSteps(sequence, at)[0];
      if (sequence === null || step === undefined) {
        continue;
      }
      // One transaction: a row with no step drafted (or the reverse) would draft the step twice.
      source.outreach.commit({
        at,
        newDrafts: [
          {
            id: newId(),
            creator: creator.id,
            kind: "followUp",
            followUp: step.n,
            mailbox: sequence.mailbox,
            replyTo: null,
            at,
          },
        ],
        sequences: [withStep(sequence, step.n, "drafted")],
      });
      any = true;
    }
    if (any) {
      deps.changed();
    }
  }

  async function runRewrite(
    mine: number,
    mode: "example" | "live",
    source: DrafterSource,
    draft: StoredDraft,
    how: RewriteHow,
    note: string,
    sender: string | null,
  ): Promise<void> {
    const flying = inFlight;
    try {
      const outcome = await exclusive(async (): Promise<Outcome> => {
        if (mode === "example") {
          await wait(standInMs);
          return {
            ok: true,
            subject: draft.subject,
            body: standInRewrite(draft.body, how),
            proposal: draft.proposal ?? standInProposal(),
          };
        }
        const creator = await creatorOf(source, draft.creator);
        if (mine !== generation || creator === null || sender === null) {
          return { ok: false, problem: "engine_failed", proposal: null };
        }
        return ask(source, draft, creator, sender, note);
      });
      if (mine !== generation) {
        return;
      }
      // The answer to a reply may read it differently now (D23): a bounce sets the draft aside.
      const bounce = await bounceRead(draft, outcome.proposal);
      if (mine !== generation) {
        return;
      }
      const current = source.outreach.draft(draft.id);
      if (current === null) {
        return;
      }
      const open = current.state === "ready" || current.state === "failed";
      let patch: DraftPatch = { rewriting: null };
      if (open && bounce) {
        patch = { rewriting: null, state: "skipped", problem: null };
      } else if (open && outcome.ok) {
        patch = {
          rewriting: null,
          state: "ready",
          subject: outcome.subject,
          body: outcome.body,
          proposal: outcome.proposal,
          problem: null,
          edited: false,
        };
      } else if (open && !outcome.ok && current.state === "ready") {
        // A note on the ready draft: its text stays as it was.
        patch = { rewriting: null, problem: outcome.problem };
      }
      if (!outcome.ok && outcome.problem === "paused") {
        scheduleResume();
      }
      source.outreach.updateDraft(draft.id, patch, now());
      deps.changed();
    } finally {
      flying.delete(draft.id);
    }
  }

  async function startRewrite(
    draftId: string,
    how: RewriteHow,
    note: string,
  ): Promise<ChannelResponse<"reach:rewrite">> {
    const mode = deps.mode();
    const source = deps.source();
    if (mode === null || source === null) {
      return { ok: false, problem: "not_found" };
    }
    const mine = generation;
    const usable = (): "ok" | "not_found" | "busy" => {
      const draft = source.outreach.draft(draftId);
      if (draft === null) {
        return "not_found";
      }
      if (inFlight.has(draftId) || draft.rewriting !== null) {
        return "busy";
      }
      const open =
        draft.state === "ready" || (draft.state === "failed" && draft.problem !== "maybe_sent");
      return open ? "ok" : "busy";
    };
    const first = usable();
    if (first !== "ok") {
      return { ok: false, problem: first };
    }
    const sender = deps.sender();
    if (mode === "live") {
      // No sender: a draft would be signed "[Your name]".
      if (sender === null) {
        return { ok: false, problem: "no_sender" };
      }
      const bridge = await checkBridge();
      if (mine !== generation) {
        return { ok: false, problem: "not_found" };
      }
      if (!bridge.ready) {
        return { ok: false, problem: "bridge_off" };
      }
      if (bridge.paused) {
        return { ok: false, problem: "paused" };
      }
      const still = usable();
      if (still !== "ok") {
        return { ok: false, problem: still };
      }
    }
    const draft = source.outreach.draft(draftId);
    if (draft === null) {
      return { ok: false, problem: "not_found" };
    }
    inFlight.add(draftId);
    source.outreach.updateDraft(draftId, { rewriting: how, steer: { how, note } }, now());
    deps.changed();
    track(runRewrite(mine, mode, source, draft, how, note, sender));
    return { ok: true };
  }

  return {
    kick() {
      kickToken += 1;
      const token = kickToken;
      const mine = generation;
      track(
        (async () => {
          await wait(kickDelayMs);
          if (token !== kickToken || mine !== generation) {
            return;
          }
          try {
            await scan(mine);
          } catch {
            console.error("Reach: looking for drafts to write failed.");
            return;
          }
          if (mine === generation) {
            work();
          }
        })(),
      );
    },

    async draftNow(creatorId) {
      const source = deps.source();
      if (deps.mode() === null || source === null) {
        return { ok: false, problem: "no_data" };
      }
      const mine = generation;
      const creator = await creatorOf(source, creatorId);
      if (mine !== generation) {
        return { ok: false, problem: "no_data" };
      }
      if (source.outreach.openDraft(creatorId) !== null) {
        return { ok: false, problem: "has_draft" };
      }
      if (creator === null || !due(source, creator)) {
        return { ok: false, problem: "not_ready" };
      }
      source.outreach.insertDraft({
        id: newId(),
        creator: creatorId,
        kind: "first",
        followUp: null,
        mailbox: pickMailbox(deps.mailboxes()),
        replyTo: null,
        at: now(),
      });
      deps.changed();
      work();
      return { ok: true };
    },

    rewrite: (draftId, how) => startRewrite(draftId, how, reachStrings.rewriteNotes[how]),

    reread: (draftId, label) => startRewrite(draftId, "redo", reachStrings.readAs(label)),

    retry(draftId) {
      const source = deps.source();
      const draft = deps.mode() === null || source === null ? null : source.outreach.draft(draftId);
      if (source === null || draft === null) {
        return Promise.resolve({ ok: false, problem: "not_found" });
      }
      if (draft.state !== "failed" || !draftingProblems.has(draft.problem)) {
        return Promise.resolve({ ok: false, problem: "wrong_state" });
      }
      source.outreach.updateDraft(draftId, { state: "drafting", problem: null }, now());
      deps.changed();
      work();
      return Promise.resolve({ ok: true });
    },

    state,

    drop() {
      generation += 1;
      kickToken += 1;
      looping = null;
      again = false;
      inFlight = new Set();
      resumeAt = null;
    },

    async idle() {
      while (pending.size > 0) {
        await Promise.all([...pending]);
      }
    },
  };
}
