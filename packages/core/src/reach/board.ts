import type { Creator, FrameSource, OutreachDraft, Sequence, ThreadSummary } from "../data";

/**
 * Reach's board (plan step 6, D14; the prototype's `boardLanes` in reach.js): where every
 * outreach stands, one lane per step. The Media kit and Signed lanes show on example data only:
 * live, they are step 8's.
 */

export const boardLaneKeys = ["todraft", "waiting", "seq", "replied", "kit", "signed"] as const;

export type BoardLaneKey = (typeof boardLaneKeys)[number];

/** The lanes live data shows (ground rule 9). */
export const liveBoardLanes: readonly BoardLaneKey[] = ["todraft", "waiting", "seq", "replied"];

export interface BoardItem {
  readonly creator: Creator;
  /** The creator's open draft (neither sent nor skipped), newest first; null when none. */
  readonly draft: OutreachDraft | null;
  readonly thread: ThreadSummary | null;
  readonly sequence: Sequence | null;
}

export interface BoardLane {
  readonly key: BoardLaneKey;
  readonly items: readonly BoardItem[];
}

export interface BoardInput {
  readonly creators: readonly Creator[];
  readonly drafts: readonly OutreachDraft[];
  readonly threads: readonly ThreadSummary[];
  readonly sequences: readonly Sequence[];
  readonly source: FrameSource;
}

/** Whether a draft still waits for something: neither sent nor skipped. */
export function isOpenDraft(draft: Pick<OutreachDraft, "state">): boolean {
  return draft.state !== "sent" && draft.state !== "skipped";
}

/** Each creator's open draft, the newest when there are several. */
export function openDrafts(drafts: readonly OutreachDraft[]): Map<string, OutreachDraft> {
  const out = new Map<string, OutreachDraft>();
  for (const draft of drafts) {
    if (!isOpenDraft(draft)) {
      continue;
    }
    const had = out.get(draft.creator);
    if (had === undefined || draft.createdAt > had.createdAt) {
      out.set(draft.creator, draft);
    }
  }
  return out;
}

/** The next step still to go, or null. */
export function nextStep(sequence: Sequence | null): Sequence["steps"][number] | null {
  if (sequence === null || sequence.stopped !== null) {
    return null;
  }
  return sequence.steps.find((s) => s.state === "planned" || s.state === "drafted") ?? null;
}

function laneOf(item: BoardItem): BoardLaneKey | null {
  const { creator, draft } = item;
  if (draft !== null) {
    if (draft.kind === "reply") {
      return "replied";
    }
    // A scheduled email waits for its time, not for the person: it shows with the sequence.
    if (draft.state === "scheduled") {
      return "seq";
    }
    if (draft.kind === "followUp") {
      return draft.state === "drafting" ? "seq" : "waiting";
    }
    return draft.state === "drafting" ? "todraft" : "waiting";
  }
  switch (creator.stage) {
    case "contact":
      return "todraft";
    case "emailed":
    case "parked":
      return "seq";
    case "replied":
      return "replied";
    case "kit":
    case "audience":
      return "kit";
    case "signed":
      return "signed";
    default:
      return null;
  }
}

/** When an In sequence card next goes: its scheduled email, else its next step. */
function seqDueAt(item: BoardItem): number {
  if (item.draft?.state === "scheduled" && item.draft.sendAt !== null) {
    return item.draft.sendAt;
  }
  return nextStep(item.sequence)?.dueAt ?? Number.POSITIVE_INFINITY;
}

const byNumber =
  <T>(key: (t: T) => number, dir: 1 | -1 = 1) =>
  (a: T, b: T): number =>
    (key(a) - key(b)) * dir;

/** The board's lanes, each sorted as the prototype sorts it. */
export function boardLanes(input: BoardInput): BoardLane[] {
  const drafts = openDrafts(input.drafts);
  const threads = new Map(input.threads.map((t) => [t.creator, t]));
  const sequences = new Map(input.sequences.map((s) => [s.creator, s]));
  const lanes = new Map<BoardLaneKey, BoardItem[]>(boardLaneKeys.map((k) => [k, []]));
  for (const creator of input.creators) {
    const item: BoardItem = {
      creator,
      draft: drafts.get(creator.id) ?? null,
      thread: threads.get(creator.id) ?? null,
      sequence: sequences.get(creator.id) ?? null,
    };
    const lane = laneOf(item);
    if (lane !== null) {
      lanes.get(lane)?.push(item);
    }
  }
  const byName = (a: BoardItem, b: BoardItem): number =>
    a.creator.name.localeCompare(b.creator.name);
  const draftAt = (i: BoardItem): number => i.draft?.createdAt ?? Number.POSITIVE_INFINITY;
  lanes.get("todraft")?.sort((a, b) => byNumber(draftAt)(a, b) || byName(a, b));
  lanes.get("waiting")?.sort((a, b) => byNumber(draftAt)(a, b) || byName(a, b));
  lanes.get("seq")?.sort((a, b) => byNumber(seqDueAt)(a, b) || byName(a, b));
  lanes
    .get("replied")
    ?.sort(
      (a, b) => byNumber((i: BoardItem) => i.thread?.lastIn?.at ?? 0, -1)(a, b) || byName(a, b),
    );
  lanes.get("kit")?.sort(byName);
  lanes.get("signed")?.sort(byName);
  const shown = input.source === "example" ? boardLaneKeys : liveBoardLanes;
  return shown.map((key) => ({ key, items: lanes.get(key) ?? [] }));
}
