import { randomUUID } from "node:crypto";

import {
  draftSubjectMax,
  messageBodyMax,
  threadMessagesMax,
  type CreatorState,
  type DataSource,
  type DataWrite,
  type DraftProposal,
  type DraftState,
  type FrameNotification,
  type NewDraft,
  type NewMessage,
  type ReplyReading,
  type Sequence,
  type StoredDraft,
} from "@gratovo/core/data";
import { readReplyFacts, stopped } from "@gratovo/core/reach";
import type { ChannelResponse, FramePart } from "@gratovo/ipc";

import type { JobOutcome } from "../pipeline/jobs";
import type { ReplyMessage, Start } from "../pipeline/protocol";
import { readMailRows, sameAddress } from "../settings/connections-store";

import type { Situations } from "./situations";
import { replyStrings } from "./strings";

/**
 * Reach's replies (plan step 6d, D17, D18, D23): the background sweep that reads new replies with
 * `mail.replies`, "Paste a reply", the reading Gemini gives a reply and "That's not it".
 *
 * Everything here ends in a draft, never a send: an answer is a `reply` draft in `drafting` (the
 * drafter writes it, a person approves it). The mailbox is read only by the sweep's `mail.replies`
 * job. A reply is acknowledged (`mail.ack`) only after it is stored in `outreach_messages`: one that
 * is not stored is offered again by the next sweep. Logs carry message ids and codes only, never an
 * address, a subject or a body.
 */

/** The first sweep comes this long after the data opens. */
export const firstSweepMs = 30_000;
/** Then one every ten minutes. */
export const sweepEveryMs = 10 * 60_000;
/** How many ids one `mail.ack` carries (the job's own limit). */
const ackMax = 500;
/**
 * A swept reply received longer ago than this, and never stored, is an old one (the mailbox may
 * have been imported, step 6e): it is stored and acknowledged, but moves no stage and raises no
 * notice or answer.
 */
export const oldReplyMs = 30 * 24 * 60 * 60_000;
/** The words of a notification's name, cut so it fits. */
const nameMax = 100;

/** The drafts a Stop, a Park or a reply skips; one being sent is left. */
const openStates: readonly DraftState[] = ["drafting", "ready", "failed", "approved", "scheduled"];

/** A creator's open follow-up drafts, as skip patches (a Stop's, and now a reply's). */
export function skipOpenFollowUps(
  source: Pick<DataSource, "outreach">,
  creatorId: string,
): { id: string; patch: { state: "skipped"; problem: null } }[] {
  return source.outreach
    .draftsIn(openStates)
    .filter((d) => d.creator === creatorId && d.kind === "followUp")
    .map((d) => ({ id: d.id, patch: { state: "skipped" as const, problem: null } }));
}

export interface ReplySweepDeps {
  mode(): "example" | "live" | null;
  source(): DataSource | null;
  /** A quick-lane job (the shared queue, with the mail secrets); null when no live data is open. */
  run(job: Start["job"]): Promise<JobOutcome | null>;
  /** The addresses with a stored refresh token. */
  connected(): Promise<readonly string[]>;
  situations: Situations;
  /** Writes an open answer draft again with the steer "Read their reply as: <label>". */
  reread(draftId: string, label: string): Promise<ChannelResponse<"reach:rewrite">>;
  /** Tells the page that `reach` changed, and the parts beside it. */
  changed(more?: readonly FramePart[]): void;
  /** The drafter should look for new work. */
  kick(): void;
  /** Drafts were skipped: the sender checks its timers again. */
  afterWrite(): void;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: (line: string) => void;
  newId?: () => string;
}

export interface ReplySweep {
  /** `reach:check-replies`: one sweep now. */
  check(): Promise<ChannelResponse<"reach:check-replies">>;
  /** Live data opened: the first sweep in 30 s, then every ten minutes. */
  start(): void;
  /** The data is closing, or the app is: no timer survives. */
  stop(): void;
  /** `reach:paste-reply`. */
  paste(creatorId: string, text: string): Promise<ChannelResponse<"reach:paste-reply">>;
  /** `reach:reclassify`. */
  reclassify(messageId: string, replyType: string): Promise<ChannelResponse<"reach:reclassify">>;
  /** `reach:situations`. */
  situations(): Promise<ChannelResponse<"reach:situations">>;
  /**
   * The drafter's hook: an answer draft's proposal says how the reply was read. Stores the reading
   * on the reply; true when it was a bounce (then no answer is written).
   */
  reading(draft: StoredDraft, proposal: DraftProposal): Promise<{ bounce: boolean }>;
}

/** What a reply (or a bounce) changes, ready for one `commit`. */
interface Change {
  newDrafts: NewDraft[];
  drafts: { id: string; patch: { state: "skipped"; problem: null } }[];
  sequences: Sequence[];
  writes: DataWrite[];
  notifications: FrameNotification[];
}

const emptyChange = (): Change => ({
  newDrafts: [],
  drafts: [],
  sequences: [],
  writes: [],
  notifications: [],
});

function addTo(into: Change, more: Change): void {
  into.newDrafts.push(...more.newDrafts);
  into.drafts.push(...more.drafts);
  into.sequences.push(...more.sequences);
  into.writes.push(...more.writes);
  into.notifications.push(...more.notifications);
}

/** A mail server's own address: a bounce, whatever Gemini says (D17). */
export function isDaemon(address: string | null): boolean {
  return address !== null && /^(?:mailer-daemon|postmaster)@/i.test(address.trim());
}

/** The address in a `From` value, which may be `Name <a@b.example>`. */
function addressOf(from: string): string {
  const angle = /<([^<>]+)>/.exec(from);
  return (angle?.[1] ?? from).trim();
}

const nameOf = (creator: CreatorState): string =>
  (creator.name ?? creator.handle).slice(0, nameMax);

/** The first words of a summary, for a reading that has no known type. */
function firstWords(summary: string): string {
  return summary.trim().split(/\s+/).slice(0, 6).join(" ");
}

/** The side whose situations a creator's reply is read against. */
function sideOf(reading: ReplyReading | null): "influencer" | "brand" {
  return reading?.side === "brand" ? "brand" : "influencer";
}

export function createReplySweep(deps: ReplySweepDeps): ReplySweep {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
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

  // --- what a reply, and what a bounce, change ---

  const logLine = (creator: CreatorState, text: string, at: number): DataWrite => ({
    kind: "log.add",
    id: newId(),
    at,
    text,
    ref: creator.id,
    action: null,
    detail: null,
  });

  const notice = (
    id: string,
    icon: "reply" | "alert",
    text: string,
    sub: string,
    at: number,
  ): FrameNotification => ({
    id,
    at,
    icon,
    text,
    sub,
    go: { screen: "reach", tab: "inbox" },
    read: false,
  });

  /**
   * A bounce (D23): the sequence stops as `bounced` and its open follow-ups are skipped, the
   * address is marked not confirmed (the inverse of Find's Confirm, through the same contact
   * write), and the person is told. Nothing is answered. A sequence already stopped as bounced
   * means this was done before.
   */
  function bounceChange(
    source: DataSource,
    creator: CreatorState,
    messageId: string,
    at: number,
    notify: boolean,
    noticeId: string = `bounce-${messageId}`,
  ): Change {
    const change = emptyChange();
    const sequence = source.outreach.sequence(creator.id);
    if (sequence?.stopped === "bounced") {
      return change;
    }
    if (sequence !== null && (sequence.stopped === null || sequence.stopped === "replied")) {
      change.sequences.push({ ...stopped(sequence), stopped: "bounced", parkUntil: null });
    }
    change.drafts.push(...skipOpenFollowUps(source, creator.id));
    // A reply that turns out to be a bounce was not a reply: with no other real message in, the
    // creator is back to emailed.
    if (
      creator.stage === "replied" &&
      !source.outreach
        .thread(creator.id, threadMessagesMax)
        .some(
          (m) =>
            m.direction === "in" &&
            m.id !== messageId &&
            !isDaemon(m.peer) &&
            m.reading?.replyType !== "any.bounce",
        )
    ) {
      change.writes.push({
        kind: "creator.stage",
        id: creator.id,
        stage: "emailed",
        handle: creator.handle,
        name: creator.name ?? creator.handle,
      });
    }
    if (creator.emailConfirmed && creator.email !== null) {
      // The label stays (a null name keeps what is stored), and so do the address's source and
      // confidence: a person who confirms it again should still see where it came from.
      change.writes.push({
        kind: "creator.contact",
        id: creator.id,
        email: creator.email,
        confirmed: false,
        contactName: null,
        source: creator.contactSource ?? null,
        confidence: creator.contactConfidence ?? null,
        handle: creator.handle,
        name: creator.name ?? creator.handle,
      });
    }
    change.writes.push(logLine(creator, replyStrings.bounced(nameOf(creator)), at));
    if (notify) {
      change.notifications.push(
        notice(
          noticeId,
          "alert",
          replyStrings.bounced(nameOf(creator)),
          replyStrings.bouncedSub,
          at,
        ),
      );
    }
    return change;
  }

  /**
   * A reply (D23), in one commit with the message: the stage goes `emailed` or `parked` to
   * `replied`, the sequence stops as `replied` and its open follow-ups are skipped, a log line, a
   * notification (not for a pasted reply: the person did it) and an answer draft, only ever
   * drafted. No answer is queued when one is open already.
   */
  function replyChange(
    source: DataSource,
    creator: CreatorState,
    message: NewMessage,
    at: number,
    o: { notify: boolean; pasted: boolean },
  ): Change {
    const change = emptyChange();
    if (creator.stage === "emailed" || creator.stage === "parked") {
      change.writes.push({
        kind: "creator.stage",
        id: creator.id,
        stage: "replied",
        handle: creator.handle,
        name: creator.name ?? creator.handle,
      });
    }
    const sequence = source.outreach.sequence(creator.id);
    if (sequence !== null && sequence.stopped === null) {
      change.sequences.push({ ...stopped(sequence), stopped: "replied", parkUntil: null });
    }
    change.drafts.push(...skipOpenFollowUps(source, creator.id));
    const name = nameOf(creator);
    change.writes.push(
      logLine(
        creator,
        o.pasted ? replyStrings.repliedPasted(name) : replyStrings.replied(name),
        at,
      ),
    );
    if (o.notify) {
      change.notifications.push(
        notice(
          `reply-${message.id}`,
          "reply",
          replyStrings.replied(name),
          message.subject.trim() === ""
            ? replyStrings.repliedSub
            : message.subject.trim().slice(0, 200),
          at,
        ),
      );
    }
    const answering = source.outreach
      .draftsIn([...openStates, "sending"])
      .some((d) => d.creator === creator.id && d.kind === "reply");
    if (!answering) {
      change.newDrafts.push({
        id: newId(),
        creator: creator.id,
        kind: "reply",
        followUp: null,
        mailbox: message.mailbox,
        replyTo: message.id,
        at,
      });
    }
    return change;
  }

  /** The effects of a creator's new messages: a bounce, or a reply (a real reply wins). */
  function changeFor(
    source: DataSource,
    creator: CreatorState,
    messages: readonly NewMessage[],
    at: number,
    o: { notify: boolean; pasted: boolean },
  ): Change {
    const real = messages.filter((m) => !isDaemon(m.peer));
    const newest = real[real.length - 1];
    // A creator who must not be written to, or who was set aside, gets the message stored and its
    // sequence stopped (so no follow-up goes out): no stage, no draft, no notice.
    if (creator.stage === "never" || creator.stage === "rejected") {
      const quiet = emptyChange();
      const sequence = source.outreach.sequence(creator.id);
      if (sequence !== null && sequence.stopped === null) {
        quiet.sequences.push({
          ...stopped(sequence),
          stopped: newest === undefined ? "bounced" : "replied",
          parkUntil: null,
        });
      }
      quiet.drafts.push(...skipOpenFollowUps(source, creator.id));
      return quiet;
    }
    if (newest === undefined) {
      const bounce = messages[messages.length - 1];
      return bounce === undefined
        ? emptyChange()
        : bounceChange(source, creator, bounce.id, at, o.notify);
    }
    return replyChange(source, creator, newest, at, o);
  }

  // --- the sweep ---

  let sweeping = false;
  /** The unmatched replies already logged in this run. */
  const unmatchedLogged = new Set<string>();
  let timer: unknown = null;
  let running = false;
  /** Bumped by every start and stop: a tick from an older run arms nothing. */
  let generation = 0;

  function incoming(reply: ReplyMessage, creator: CreatorState, at: number): NewMessage {
    return {
      id: newId(),
      creator: creator.id,
      direction: "in",
      kind: null,
      followUp: null,
      subject: reply.subject.slice(0, draftSubjectMax),
      body: reply.body,
      bodyCut: reply.bodyCut,
      at,
      mailbox: reply.account,
      peer: addressOf(reply.from).slice(0, 320),
      peerName: reply.fromName,
      conversationKey: reply.conversationKey,
      gmailMessageId: reply.messageId,
      gmailThreadId: null,
      draftId: null,
      by: null,
      source: "sweep",
      reading: null,
    };
  }

  /** The creator a reply belongs to: its channel, else its conversation key, else its sender. */
  function match(
    reply: ReplyMessage,
    byId: ReadonlyMap<string, CreatorState>,
    byEmail: ReadonlyMap<string, CreatorState | null>,
  ): CreatorState | null {
    const channel = reply.channelId === null ? undefined : byId.get(reply.channelId);
    if (channel !== undefined) {
      return channel;
    }
    const key = /^c:(.+)$/.exec(reply.conversationKey)?.[1];
    const keyed = key === undefined ? undefined : byId.get(key);
    if (keyed !== undefined) {
      return keyed;
    }
    return byEmail.get(addressOf(reply.from).toLowerCase()) ?? null;
  }

  function codeOf(outcome: JobOutcome): string {
    if (!outcome.ok) {
      return outcome.problem;
    }
    return outcome.exit.kind === "ended"
      ? (outcome.exit.end.error?.code ?? outcome.exit.end.state)
      : outcome.exit.reason;
  }

  async function ack(ids: readonly string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += ackMax) {
      const chunk = ids.slice(i, i + ackMax);
      try {
        const outcome = await deps.run({ kind: "mail.ack", messageIds: chunk });
        if (
          outcome === null ||
          !outcome.ok ||
          outcome.exit.kind !== "ended" ||
          outcome.exit.end.state !== "done"
        ) {
          // The replies are stored; a later sweep offers them again and acknowledges them then.
          log(
            `Reach: the acknowledgement of replies failed (${outcome === null ? "no_data" : codeOf(outcome)}).`,
          );
        }
      } catch {
        log("Reach: the acknowledgement of replies failed.");
      }
    }
  }

  async function sweep(source: DataSource): Promise<ChannelResponse<"reach:check-replies">> {
    const rows = readMailRows(source).mailboxes;
    const tokens = await deps.connected();
    if (!rows.some((row) => tokens.some((address) => sameAddress(address, row.address)))) {
      return { ok: false, problem: "no_mail" };
    }
    const outcome = await deps.run({ kind: "mail.replies" });
    if (outcome === null || deps.source() !== source) {
      return { ok: false, problem: "no_data" };
    }
    if (!outcome.ok || outcome.exit.kind !== "ended") {
      log(`Reach: the reply check couldn't run (${codeOf(outcome)}).`);
      return { ok: false, problem: "failed" };
    }
    const { exit } = outcome;
    if (exit.end.state !== "done" || exit.result?.kind !== "mail.replies") {
      const code = exit.end.error?.code ?? exit.end.state;
      log(`Reach: the reply check ended without an answer (${code}).`);
      return code === "mail_not_connected"
        ? { ok: false, problem: "no_mail" }
        : { ok: false, problem: "failed" };
    }
    for (const account of exit.result.data.accounts) {
      if (account.error !== null) {
        log(`Reach: a mailbox's reply check had a problem (${account.error.code}).`);
      }
    }
    // One reply once, even if the job named it twice.
    const seen = new Set<string>();
    const replies = outcome.replies.filter((reply) => {
      if (seen.has(reply.messageId)) {
        return false;
      }
      seen.add(reply.messageId);
      return true;
    });
    if (replies.length === 0) {
      return { ok: true, stored: 0 };
    }

    const states = await source.creatorStates();
    if (deps.source() !== source) {
      return { ok: false, problem: "no_data" };
    }
    // From here to the commit nothing waits: what is read is what is written.
    const byId = new Map(states.map((c) => [c.id, c]));
    // An address two creators share belongs to neither (null): the reply stays unmatched.
    const byEmail = new Map<string, CreatorState | null>();
    for (const c of states) {
      const email = c.email?.trim().toLowerCase();
      if (email !== undefined && email !== "") {
        byEmail.set(email, byEmail.has(email) ? null : c);
      }
    }
    const matched: { reply: ReplyMessage; creator: CreatorState }[] = [];
    for (const reply of replies) {
      const creator = match(reply, byId, byEmail);
      if (creator === null) {
        // Not stored and not acknowledged: the next sweep offers it again (logged once).
        if (!unmatchedLogged.has(reply.messageId)) {
          unmatchedLogged.add(reply.messageId);
          log(`Reach: a reply wasn't matched to a creator (${reply.messageId}).`);
        }
      } else {
        matched.push({ reply, creator });
      }
    }
    const already = source.outreach.storedGmailIds(matched.map((m) => m.reply.messageId));
    const fresh = matched.filter((m) => !already.has(m.reply.messageId));

    const at = now();
    const messages: NewMessage[] = [];
    const change = emptyChange();
    const perCreator = new Map<string, { creator: CreatorState; messages: NewMessage[] }>();
    let old = 0;
    for (const { reply, creator } of fresh) {
      const received = reply.receivedAt === null ? Number.NaN : Date.parse(reply.receivedAt);
      const message = incoming(reply, creator, Number.isNaN(received) ? at : received);
      messages.push(message);
      if (message.at < at - oldReplyMs) {
        // An old one (an imported mailbox): kept and acknowledged, and nothing else.
        old += 1;
        continue;
      }
      const entry = perCreator.get(creator.id) ?? { creator, messages: [] };
      entry.messages.push(message);
      perCreator.set(creator.id, entry);
    }
    if (old > 0) {
      // One line for them all: an imported mailbox can hold thousands (review of 6e, finding 14).
      log(`Reach: ${String(old)} old replies were stored without action.`);
    }
    for (const { creator, messages: list } of perCreator.values()) {
      list.sort((a, b) => a.at - b.at);
      addTo(change, changeFor(source, creator, list, at, { notify: true, pasted: false }));
    }
    if (messages.length > 0) {
      try {
        source.outreach.commit({ at, messages, ...change });
      } catch {
        // Nothing is stored, so nothing is acknowledged.
        log("Reach: storing the replies failed.");
        return { ok: false, problem: "failed" };
      }
    }
    // Only what is in the table is acknowledged: this sweep's new replies, and any an earlier
    // sweep stored but could not acknowledge.
    // Every reply of the sweep counts, matched or not: one stored earlier that no longer matches
    // anyone is acknowledged too.
    const stored = source.outreach.storedGmailIds(replies.map((r) => r.messageId));
    const ids = replies.map((r) => r.messageId).filter((id) => stored.has(id));
    const newCount = fresh.filter((m) => stored.has(m.reply.messageId)).length;
    if (newCount > 0) {
      deps.changed(["log", "creators", "notify"]);
      deps.afterWrite();
      deps.kick();
    }
    if (ids.length > 0) {
      await ack(ids);
    }
    return { ok: true, stored: newCount };
  }

  async function check(): Promise<ChannelResponse<"reach:check-replies">> {
    const mode = deps.mode();
    const source = deps.source();
    if (mode === null || source === null) {
      return { ok: false, problem: "no_data" };
    }
    if (mode === "example") {
      return { ok: false, problem: "example" };
    }
    if (sweeping) {
      return { ok: false, problem: "busy" };
    }
    sweeping = true;
    try {
      return await sweep(source);
    } catch {
      log("Reach: the reply check failed.");
      return { ok: false, problem: "failed" };
    } finally {
      sweeping = false;
    }
  }

  function arm(ms: number): void {
    const mine = generation;
    timer = setTimer(() => {
      timer = null;
      void tick(mine);
    }, ms);
  }

  async function tick(mine: number): Promise<void> {
    try {
      await check();
    } finally {
      if (running && mine === generation && deps.mode() === "live") {
        arm(sweepEveryMs);
      }
    }
  }

  function stop(): void {
    running = false;
    generation += 1;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  // --- paste a reply ---

  async function paste(
    creatorId: string,
    text: string,
  ): Promise<ChannelResponse<"reach:paste-reply">> {
    const source = deps.source();
    if (source === null || deps.mode() === null) {
      return { ok: false, problem: "no_data" };
    }
    const creator = (await source.creatorStates()).find((c) => c.id === creatorId) ?? null;
    if (deps.source() !== source) {
      return { ok: false, problem: "no_data" };
    }
    if (creator === null) {
      return { ok: false, problem: "not_found" };
    }
    if (!source.outreach.hasOutbound(creatorId, true)) {
      return { ok: false, problem: "no_outbound" };
    }
    // From the mailbox the creator was written from: the sequence's, else the newest email out.
    const sent = source.outreach
      .thread(creatorId, 200)
      .filter((m) => m.direction === "out")
      .pop();
    const at = now();
    const body = text.trim();
    const message: NewMessage = {
      id: newId(),
      creator: creatorId,
      direction: "in",
      kind: null,
      followUp: null,
      subject: /^re:/i.test(sent?.subject ?? "")
        ? (sent?.subject ?? "")
        : `Re: ${sent?.subject ?? ""}`.trim().slice(0, draftSubjectMax),
      body: body.slice(0, messageBodyMax),
      bodyCut: body.length > messageBodyMax,
      at,
      mailbox: source.outreach.sequence(creatorId)?.mailbox ?? sent?.mailbox ?? null,
      peer: creator.email,
      peerName: creator.contactName,
      conversationKey: `c:${creatorId}`,
      gmailMessageId: null,
      gmailThreadId: null,
      draftId: null,
      by: null,
      source: "pasted",
      reading: null,
    };
    const change = changeFor(source, creator, [message], at, { notify: false, pasted: true });
    try {
      source.outreach.commit({ at, messages: [message], ...change });
    } catch {
      log("Reach: storing a pasted reply failed.");
      return { ok: false, problem: "no_data" };
    }
    deps.changed(["log", "creators", "notify"]);
    deps.afterWrite();
    deps.kick();
    return { ok: true };
  }

  // --- the reading, and "That's not it" ---

  async function reading(
    draft: StoredDraft,
    proposal: DraftProposal,
  ): Promise<{ bounce: boolean }> {
    const source = deps.source();
    const situation = proposal.situation;
    if (source === null || situation === null || draft.replyTo === null) {
      return { bounce: false };
    }
    const label =
      (situation.replyType === null ? null : await deps.situations.labelOf(situation.replyType)) ??
      firstWords(situation.summary);
    const states = await source.creatorStates();
    if (deps.source() !== source) {
      return { bounce: false };
    }
    // Read after the awaits: a person's correction in the meantime stays.
    const message = source.outreach.message(draft.replyTo);
    if (message === null || message.direction !== "in") {
      return { bounce: false };
    }
    if (message.reading?.corrected === true) {
      return { bounce: message.reading.replyType === "any.bounce" };
    }
    const next: ReplyReading = {
      replyType: situation.replyType,
      label: label.slice(0, 300),
      summary: situation.summary.slice(0, 5000),
      side: situation.side,
      corrected: false,
      facts: readReplyFacts(message.body),
    };
    const bounce = next.replyType === "any.bounce";
    const at = now();
    const creator = states.find((c) => c.id === message.creator) ?? null;
    const change =
      bounce && creator !== null && creator.stage !== "never" && creator.stage !== "rejected"
        ? bounceChange(source, creator, message.id, at, true, `reply-${message.id}`)
        : emptyChange();
    source.outreach.commit({ at, readings: [{ id: message.id, reading: next }], ...change });
    deps.changed(bounce ? ["log", "creators", "notify"] : []);
    if (bounce) {
      deps.afterWrite();
    }
    return { bounce };
  }

  async function reclassify(
    messageId: string,
    replyType: string,
  ): Promise<ChannelResponse<"reach:reclassify">> {
    const source = deps.source();
    if (source === null || deps.mode() === null) {
      return { ok: false, problem: "no_data" };
    }
    const first = source.outreach.message(messageId);
    if (first === null || first.direction !== "in") {
      return { ok: false, problem: "not_found" };
    }
    const list = await deps.situations.list();
    const side = sideOf(first.reading);
    const entry = list.find((s) => s.id === replyType && (s.side === side || s.side === "any"));
    if (entry === undefined) {
      return { ok: false, problem: "unknown_type" };
    }
    const states = await source.creatorStates();
    if (deps.source() !== source) {
      return { ok: false, problem: "no_data" };
    }
    // Read again after the awaits: the reading is what it is now.
    const message = source.outreach.message(messageId);
    if (message === null || message.direction !== "in") {
      return { ok: false, problem: "not_found" };
    }
    const was = message.reading;
    const next: ReplyReading = {
      replyType: entry.id,
      label: entry.label,
      summary: was?.summary ?? "",
      side: was?.side ?? side,
      corrected: true,
      facts: was?.facts ?? readReplyFacts(message.body),
    };
    const at = now();
    const creator = states.find((c) => c.id === message.creator) ?? null;
    const bounce = entry.id === "any.bounce";
    const change =
      bounce && creator !== null && creator.stage !== "never" && creator.stage !== "rejected"
        ? bounceChange(source, creator, message.id, at, true, `reply-${message.id}`)
        : emptyChange();
    const answers = source.outreach
      .draftsIn([...openStates, "sending"])
      .filter((d) => d.creator === message.creator && d.kind === "reply");
    if (bounce) {
      // A bounce has nobody to answer: the open answer is set aside, as the sweep's would be.
      change.drafts.push(
        ...answers
          .filter((d) => d.state !== "sending")
          .map((d) => ({ id: d.id, patch: { state: "skipped" as const, problem: null } })),
      );
    }
    source.outreach.commit({ at, readings: [{ id: message.id, reading: next }], ...change });
    deps.changed(bounce ? ["log", "creators", "notify"] : []);
    if (bounce) {
      deps.afterWrite();
      return { ok: true, rewritten: false };
    }
    // The newest answer, when it is open (ready, or failed with nothing sent), is written again
    // with the person's reading as its steer; one being written, approved or scheduled is not.
    const answer = answers[answers.length - 1];
    if (
      answer === undefined ||
      !(answer.state === "ready" || (answer.state === "failed" && answer.problem !== "maybe_sent"))
    ) {
      return { ok: true, rewritten: false };
    }
    const result = await deps.reread(answer.id, entry.label);
    if (result.ok) {
      return { ok: true, rewritten: true };
    }
    if (result.problem === "not_found") {
      return { ok: true, rewritten: false };
    }
    // The reading is changed already; the answer could not be written again for this reason.
    return { ok: false, problem: result.problem === "no_sender" ? "bridge_off" : result.problem };
  }

  async function situations(): Promise<ChannelResponse<"reach:situations">> {
    if (deps.source() === null || deps.mode() === null) {
      return { ok: false, problem: "no_data" };
    }
    const list = await deps.situations.list();
    return {
      ok: true,
      situations: list.map(({ id, label, side }) => ({ id, label, side })),
    };
  }

  return {
    check,
    start() {
      stop();
      if (deps.mode() !== "live") {
        return;
      }
      running = true;
      arm(firstSweepMs);
    },
    stop,
    paste,
    reclassify,
    situations,
    reading,
  };
}
