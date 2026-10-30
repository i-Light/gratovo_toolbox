import type { Brand, Deal } from "../data";
import { DEAL_FLOW } from "../deal-flow";
import { isOpenDraft } from "../reach/board";
import type { NextAction, NextWorld, RecordRef } from "./engine-types";
import { bestBrandFor } from "./match";

const DAY = 86_400_000;

type Creator = NextWorld["creators"][number];

function creatorNext(c: Creator, world: NextWorld): NextAction {
  let draft: (typeof world.reach.drafts)[number] | null = null;
  for (const d of world.reach.drafts) {
    if (d.creator === c.id && isOpenDraft(d) && (draft === null || d.createdAt > draft.createdAt)) {
      draft = d;
    }
  }
  if (draft !== null) {
    return {
      waiting: false,
      kind: "draft",
      draftId: draft.id,
      draft: draft.kind,
      n: draft.followUp,
      at: draft.createdAt,
    };
  }
  const sequence = world.reach.sequences.find((s) => s.creator === c.id) ?? null;
  const thread = world.reach.threads.find((t) => t.creator === c.id) ?? null;
  switch (c.stage) {
    case "new":
      return { waiting: false, kind: "review" };
    case "shortlisted":
      return { waiting: false, kind: "confirmEmail", hasEmail: c.email !== null };
    case "contact":
      return { waiting: false, kind: "firstEmail" };
    case "emailed": {
      const next = sequence?.steps.find((s) => s.state === "planned" || s.state === "drafted");
      if (next !== undefined) {
        return { waiting: true, kind: "followUpDue", n: next.n, at: next.dueAt };
      }
      if (sequence !== null && sequence.stopped === null) {
        return { waiting: true, kind: "sequenceDone" };
      }
      const first = sequence?.steps.find((s) => s.state === "sent");
      return {
        waiting: true,
        kind: "awaitReply",
        since: first?.sentAt ?? sequence?.startedAt ?? null,
      };
    }
    case "replied": {
      const out = thread?.lastOutAt ?? null;
      const lastIn = thread?.lastIn ?? null;
      if (out !== null && (lastIn === null || out > lastIn.at)) {
        return world.now - out >= 2 * DAY
          ? { waiting: false, kind: "nudgeKit", askedAt: out }
          : { waiting: true, kind: "awaitKit", askedAt: out, nudgeAt: out + 2 * DAY };
      }
      return { waiting: false, kind: "askKit", repliedAt: lastIn?.at ?? null };
    }
    case "kit":
    case "audience":
      return { waiting: false, kind: "checkAudience", kitAt: c.kitAt };
    case "signed": {
      if (c.lastUpdateAt !== null && world.now - c.lastUpdateAt >= 10 * DAY) {
        return {
          waiting: false,
          kind: "warmth",
          days: Math.floor((world.now - c.lastUpdateAt) / DAY),
        };
      }
      const mc = world.matchCreator(c.id);
      const best = mc === null ? null : bestBrandFor(mc, world);
      return {
        waiting: false,
        kind: "pitchCreator",
        brandId: best?.brandId ?? null,
        score: best?.match.score ?? null,
        why: best?.match.why[0] ?? null,
      };
    }
    case "parked":
      return { waiting: true, kind: "parked", until: sequence?.parkUntil ?? null };
    case "rejected":
      return { waiting: true, kind: "archived", at: c.archiveDueAt };
    case "never":
      return { waiting: true, kind: "never" };
  }
}

function brandNext(b: Brand, world: NextWorld): NextAction {
  switch (b.status) {
    case "found":
      return { waiting: false, kind: "qualify", seen: b.seen.length };
    case "qualified":
      return { waiting: false, kind: "pitchBrand", budget: b.budget };
    case "pitched": {
      // A pitched brand with no pitch on file counts as pitched just now.
      const at = b.pitched?.at ?? world.now;
      return at + 5 * DAY <= world.now
        ? { waiting: false, kind: "brandNudge", pitchedAt: at }
        : { waiting: true, kind: "awaitBrand", pitchedAt: at, nudgeAt: at + 5 * DAY };
    }
    case "negotiating":
      return { waiting: false, kind: "agreePrice" };
    case "won":
      return {
        waiting: false,
        kind: "nextCreator",
        deals: world.deals.filter((d) => d.brand === b.id).length,
      };
    case "lost":
      return { waiting: true, kind: "notFit" };
  }
}

function dealNext(d: Deal): NextAction {
  if (d.step === 6 && d.invoice.sentAt === null) {
    return { waiting: false, kind: "sendInvoice", goLiveAt: d.goLiveAt };
  }
  if (d.invoice.paidAt !== null && d.paidCreatorAt === null && d.step >= 6) {
    return { waiting: false, kind: "payCreator", amount: d.payout, paidAt: d.invoice.paidAt };
  }
  if (d.step === 8 && d.invoice.paidAt === null) {
    return { waiting: true, kind: "awaitPayment", dueAt: d.invoice.dueAt };
  }
  const count = DEAL_FLOW[d.step]?.items.length ?? 0;
  let item: number | null = null;
  for (let i = 0; i < count; i++) {
    if (d.checks[i] !== true) {
      item = i;
      break;
    }
  }
  return { waiting: false, kind: "dealStep", step: d.step, item, dueAt: d.dueAt };
}

/** The one next thing to do on a record, or null for an id nobody knows (ported from `W.nextFor`). */
export function nextFor(ref: RecordRef, world: NextWorld): NextAction | null {
  if (ref.kind === "creator") {
    const c = world.creators.find((x) => x.id === ref.id);
    return c === undefined ? null : creatorNext(c, world);
  }
  if (ref.kind === "brand") {
    const b = world.brands.find((x) => x.id === ref.id);
    return b === undefined ? null : brandNext(b, world);
  }
  const d = world.deals.find((x) => x.id === ref.id);
  return d === undefined ? null : dealNext(d);
}
