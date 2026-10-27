import { randomUUID } from "node:crypto";

import { checkAudience, signingStages } from "@gratovo/core/close";
import type {
  CreatorStage,
  CreatorState,
  DataSource,
  DataWrite,
  DraftGoal,
  DraftState,
  Sequence,
} from "@gratovo/core/data";
import { sequenceRestoreMax, type ChannelInput, type ChannelResponse } from "@gratovo/ipc";

import { skipOpenDrafts } from "./reply-sweep";
import { signingStrings } from "./strings";

/**
 * Close's commands in main (plan step 8, D6 and D7): Decline kindly and Ask for what's missing.
 * Each ends in a draft that waits for a person; nothing here approves or sends.
 */

export interface SigningDeps {
  mode(): "example" | "live" | null;
  source(): DataSource | null;
  now(): number;
  /** The page hears of the log line and the stage the command wrote, and the sender checks again. */
  afterCommand(): void;
  /** The drafter should look for new work. */
  kick(): void;
  /** Brings back a Stop's, Park's or Decline's skipped follow-up (the service's helper). */
  restoreDrafts(
    source: DataSource,
    creatorId: string,
    restore: readonly string[],
    sequence: Sequence,
  ): { drafts: { id: string; patch: { state: DraftState; problem: null } }[]; sequence: Sequence };
  newId?: () => string;
}

export interface Signing {
  decline(creatorId: string): Promise<ChannelResponse<"close:decline">>;
  undoDecline(
    request: ChannelInput<"close:decline-undo">,
  ): Promise<ChannelResponse<"close:decline-undo">>;
  ask(creatorId: string): Promise<ChannelResponse<"close:ask">>;
}

/** The draft states a decline draft is skipped from on an Undo; a person's approval is kept. */
const skippable: readonly DraftState[] = ["drafting", "ready", "failed"];

export function createSigning(deps: SigningDeps): Signing {
  const newId = deps.newId ?? randomUUID;
  const nameOf = (creator: CreatorState): string => creator.name ?? creator.handle;

  const logLine = (
    creator: CreatorState,
    text: string,
    at: number,
    action: "creator.reject" | "creator.restore" | null = null,
    detail: string | null = null,
  ): DataWrite => ({
    kind: "log.add",
    id: newId(),
    at,
    text,
    ref: creator.id,
    action,
    detail,
  });

  const stageWrite = (
    creator: CreatorState,
    stage: CreatorStage,
    reason?: "audience",
  ): DataWrite => ({
    kind: "creator.stage",
    id: creator.id,
    stage,
    handle: creator.handle,
    name: nameOf(creator),
    ...(reason === undefined ? {} : { reason }),
  });

  async function find(
    creatorId: string,
  ): Promise<{ source: DataSource; creator: CreatorState } | { problem: "no_data" | "not_found" }> {
    const source = deps.source();
    if (source === null || deps.mode() === null) {
      return { problem: "no_data" };
    }
    const creator = (await source.creatorStates()).find((c) => c.id === creatorId) ?? null;
    if (deps.source() !== source) {
      return { problem: "no_data" };
    }
    return creator === null ? { problem: "not_found" } : { source, creator };
  }

  /** The reply a goal draft answers, and the mailbox the thread used. */
  function newestInbound(
    source: DataSource,
    creatorId: string,
  ): { id: string; mailbox: string | null } | null {
    const message = source.outreach
      .thread(creatorId, 500)
      .filter((m) => m.direction === "in")
      .pop();
    return message === undefined ? null : { id: message.id, mailbox: message.mailbox };
  }

  function goalDraft(
    source: DataSource,
    creatorId: string,
    goal: DraftGoal,
    at: number,
  ): {
    id: string;
    creator: string;
    kind: "reply";
    goal: DraftGoal;
    followUp: null;
    mailbox: string | null;
    replyTo: string | null;
    at: number;
  } {
    const inbound = newestInbound(source, creatorId);
    return {
      id: newId(),
      creator: creatorId,
      kind: "reply",
      goal,
      followUp: null,
      mailbox: inbound?.mailbox ?? null,
      replyTo: inbound?.id ?? null,
      at,
    };
  }

  async function decline(creatorId: string): Promise<ChannelResponse<"close:decline">> {
    const found = await find(creatorId);
    if (!("source" in found)) {
      return { ok: false, problem: found.problem };
    }
    const { source, creator } = found;
    if (!signingStages.includes(creator.stage)) {
      return { ok: false, problem: "wrong_state" };
    }
    const at = deps.now();
    const skip = skipOpenDrafts(source, creatorId);
    const draft = goalDraft(source, creatorId, "decline", at);
    const hasInbound = draft.replyTo !== null;
    source.outreach.commit({
      at,
      drafts: skip,
      ...(hasInbound ? { newDrafts: [draft] } : {}),
      writes: [
        stageWrite(creator, "rejected", "audience"),
        logLine(
          creator,
          signingStrings.declined(nameOf(creator)),
          at,
          "creator.reject",
          "audience",
        ),
      ],
    });
    deps.afterCommand();
    deps.kick();
    return {
      ok: true,
      draftId: hasInbound ? draft.id : null,
      before: creator.stage,
      skipped: skip.map((d) => d.id).slice(0, sequenceRestoreMax),
    };
  }

  async function undoDecline(
    request: ChannelInput<"close:decline-undo">,
  ): Promise<ChannelResponse<"close:decline-undo">> {
    const found = await find(request.creatorId);
    if (!("source" in found)) {
      return { ok: false, problem: found.problem };
    }
    const { source, creator } = found;
    if (creator.stage !== "rejected") {
      return { ok: false, problem: "wrong_state" };
    }
    const at = deps.now();
    const patches: { id: string; patch: { state: DraftState; problem: null } }[] = [];
    // The decline draft goes, unless a person approved it or it is on its way. It is skipped
    // first, so the creator has no open draft of its own when the skipped ones come back.
    const declining = request.draftId === null ? null : source.outreach.draft(request.draftId);
    if (
      declining !== null &&
      declining.creator === creator.id &&
      declining.goal === "decline" &&
      skippable.includes(declining.state)
    ) {
      source.outreach.updateDraft(declining.id, { state: "skipped", problem: null }, at);
    }
    // Skipped drafts come back as ready (or drafting), never approved or scheduled, and only when
    // nothing else is open for the creator by then. At most one comes back.
    let sequences: Sequence[] = [];
    if (source.outreach.openDraft(creator.id) === null) {
      const sequence = source.outreach.sequence(creator.id);
      const restored =
        sequence === null
          ? null
          : deps.restoreDrafts(source, creator.id, request.skipped, sequence);
      if (restored !== null && restored.drafts.length > 0) {
        patches.push(...restored.drafts);
        sequences = [restored.sequence];
      } else {
        for (const id of request.skipped.slice(0, sequenceRestoreMax)) {
          const draft = source.outreach.draft(id);
          if (draft?.creator === creator.id && draft.state === "skipped") {
            patches.push({
              id,
              patch: { state: draft.body === "" ? "drafting" : "ready", problem: null },
            });
            break;
          }
        }
      }
    }
    source.outreach.commit({
      at,
      drafts: patches,
      sequences,
      writes: [
        stageWrite(creator, request.before as CreatorStage),
        logLine(creator, signingStrings.undidDeclining(nameOf(creator)), at, "creator.restore"),
      ],
    });
    deps.afterCommand();
    deps.kick();
    return { ok: true };
  }

  async function ask(creatorId: string): Promise<ChannelResponse<"close:ask">> {
    const found = await find(creatorId);
    if (!("source" in found)) {
      return { ok: false, problem: found.problem };
    }
    const { source, creator } = found;
    if (!signingStages.includes(creator.stage)) {
      return { ok: false, problem: "wrong_state" };
    }
    if (checkAudience(creator.kit).missing.length === 0) {
      return { ok: false, problem: "nothing_missing" };
    }
    if (source.outreach.openDraft(creatorId) !== null) {
      return { ok: false, problem: "draft_open" };
    }
    const at = deps.now();
    const draft = goalDraft(source, creatorId, "ask_kit", at);
    source.outreach.commit({
      at,
      newDrafts: [draft],
      writes: [logLine(creator, signingStrings.asked(nameOf(creator)), at)],
    });
    deps.afterCommand();
    deps.kick();
    return { ok: true, draftId: draft.id };
  }

  return { decline, undoDecline, ask };
}
