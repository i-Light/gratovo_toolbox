import { canSign } from "@gratovo/core/close";
import type { Creator, KitInput } from "@gratovo/core/data";

import { strings } from "../strings";
import { act, peek } from "./actions";
import { parkCreator } from "./reach-actions";
import { appStore, go } from "./store";
import { toast } from "./toast";

const t = strings.close.actions;

/** How long a park for the audience lasts. */
const parkDays = 90;
const dayMs = 86_400_000;

const problems: Partial<Record<string, string>> = t.problems;
/** A problem main named, in plain words; unknown ones get the general line. */
const problemWords = (problem: string): string => problems[problem] ?? t.problems.no_data;

const creatorOf = (id: string): Creator | undefined =>
  appStore()
    .getState()
    .data.creators.find((c) => c.id === id);

/** Opens the creator's record on the Emails tab, where the draft waits. */
function reviewDraft(creatorId: string): void {
  peek({ kind: "creator", id: creatorId }, undefined, { tab: "emails" });
}

/** Moves a creator from Media kit in or Audience checked to Signed, when the check passes. Ctrl Z takes it back. */
export function sign(creatorId: string): boolean {
  const creator = creatorOf(creatorId);
  if (creator === undefined || !canSign(creator.stage, creator.kit)) {
    return false;
  }
  const name = creator.name;
  const done = act(
    t.signed(name),
    (data) => {
      const target = data.creators.find((c) => c.id === creatorId);
      if (target === undefined || !canSign(target.stage, target.kit)) {
        return false;
      }
      target.stage = "signed";
      return true;
    },
    {
      logRef: { ref: creatorId, action: null, detail: null },
      toast: {
        msg: t.signedToast(name),
        sub: t.signedSub,
        icon: "pen",
        go: {
          label: t.roster,
          run: () => {
            go("close", "roster");
          },
        },
      },
    },
  );
  return done;
}

/** Asks main to take the creator out and draft a kind reply. Undo puts everything back. */
export async function decline(creatorId: string): Promise<boolean> {
  const name = creatorOf(creatorId)?.name ?? "";
  let result;
  try {
    result = await window.gratovo.invoke("close:decline", { creatorId });
  } catch {
    toast({ msg: t.problems.unreachable, icon: "alert" });
    return false;
  }
  if (!result.ok) {
    toast({ msg: t.problems.unreachable, icon: "alert" });
    return false;
  }
  const answer = result.value;
  if (!answer.ok) {
    toast({ msg: problemWords(answer.problem), icon: "alert" });
    return false;
  }
  toast({
    msg: t.declined(name),
    sub: answer.draftId === null ? t.declinedNoDraftSub : t.declinedSub,
    icon: "x",
    actions: [
      ...(answer.draftId === null
        ? []
        : [
            {
              label: t.reviewIt,
              run: () => {
                reviewDraft(creatorId);
              },
            },
          ]),
      {
        label: t.undo,
        run: () => {
          void undoDecline(creatorId, answer);
        },
      },
    ],
  });
  return true;
}

async function undoDecline(
  creatorId: string,
  answer: { readonly draftId: string | null; readonly before: string; readonly skipped: string[] },
): Promise<void> {
  let worked = false;
  try {
    const result = await window.gratovo.invoke("close:decline-undo", {
      creatorId,
      draftId: answer.draftId,
      before: answer.before,
      skipped: answer.skipped,
    });
    worked = result.ok && result.value.ok;
    if (result.ok && result.value.ok && "kept" in result.value) {
      const kept: unknown = result.value.kept;
      if (kept === "sending" || kept === "sent") {
        toast({ msg: t.undoKept, sub: t.undoKeptSub, icon: "mail" });
        return;
      }
    }
  } catch {
    // The answer stays "not worked".
  }
  if (!worked) {
    toast({ msg: t.undoFailed, sub: t.undoFailedSub, icon: "alert" });
  }
}

/** Drafts an email that asks the creator for the missing numbers. Undo skips the draft. */
export async function askMissing(creatorId: string): Promise<boolean> {
  const name = creatorOf(creatorId)?.name ?? "";
  let result;
  try {
    result = await window.gratovo.invoke("close:ask", { creatorId });
  } catch {
    toast({ msg: t.problems.unreachable, icon: "alert" });
    return false;
  }
  if (!result.ok) {
    toast({ msg: t.problems.unreachable, icon: "alert" });
    return false;
  }
  const answer = result.value;
  if (!answer.ok) {
    const problemName: string = answer.problem;
    if (answer.problem === "draft_open") {
      toast({
        msg: t.draftOpen,
        sub: t.draftOpenSub,
        icon: "mail",
        actions: [
          {
            label: t.reviewIt,
            run: () => {
              reviewDraft(creatorId);
            },
          },
        ],
      });
    } else if (problemName === "no_thread") {
      toast({ msg: t.noThread(name), icon: "alert" });
    } else {
      toast({ msg: problemWords(answer.problem), icon: "alert" });
    }
    return false;
  }
  const draftId = answer.draftId;
  toast({
    msg: t.askedToast(name),
    sub: t.askedSub,
    icon: "mail",
    actions: [
      {
        label: t.reviewIt,
        run: () => {
          reviewDraft(creatorId);
        },
      },
      {
        label: t.undo,
        run: () => {
          void undoAsk(draftId);
        },
      },
    ],
  });
  return true;
}

/** Skips the asked-for draft straight through `data:write`, so it doesn't matter whether the store has it yet. */
async function undoAsk(draftId: string): Promise<void> {
  let ok = false;
  try {
    const result = await window.gratovo.invoke("data:write", {
      writes: [{ kind: "draft.state", id: draftId, state: "skipped", sendAt: null }],
    });
    ok = result.ok;
  } catch {
    // The answer stays "not ok".
  }
  if (!ok) {
    toast({ msg: t.undoFailed, sub: t.undoFailedSub, icon: "alert" });
  }
}

/** Parks the creator for 90 days. The toast is Reach's own: it says until when and how to undo. */
export function parkForAudience(creatorId: string): Promise<boolean> {
  return parkCreator(creatorId, Date.now() + parkDays * dayMs);
}

/** Saves what the person typed into the media kit, straight through `data:write` (not an undo step). */
export async function saveKit(creatorId: string, input: KitInput): Promise<boolean> {
  const creator = creatorOf(creatorId);
  if (creator === undefined) {
    toast({ msg: t.kitFailed, sub: t.kitFailedSub, icon: "alert" });
    return false;
  }
  let ok = false;
  try {
    const result = await window.gratovo.invoke("data:write", {
      writes: [
        {
          kind: "creator.kit",
          id: creatorId,
          kit: input,
          handle: creator.handle,
          name: creator.name,
        },
      ],
    });
    ok = result.ok;
  } catch {
    // The write stays "not ok".
  }
  if (!ok) {
    toast({ msg: t.kitFailed, sub: t.kitFailedSub, icon: "alert" });
    return false;
  }
  toast({ msg: t.kitSaved(creator.name), sub: t.kitSavedSub, icon: "check", tone: "good" });
  return true;
}
