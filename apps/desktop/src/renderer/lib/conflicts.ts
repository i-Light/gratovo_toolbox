import type { Bridge } from "@gratovo/ipc/bridge";

import { strings } from "../strings";
import { subscribeApp, appStore } from "./store";
import type { EditConflict } from "./store";
import { toast } from "./toast";

/** The choice waits for an answer, so the toast stays longer than a plain one (milliseconds). */
const choiceToastMs = 30_000;

/** The longest side of a clash the toast shows, in characters. */
const shownMax = 120;

let send: Bridge["invoke"] | null = null;

/** The bridge's `invoke`, from `installConflictToasts` or, before that, the page's own bridge. */
function invoker(): Bridge["invoke"] | null {
  return send ?? (globalThis as { gratovo?: Partial<Bridge> }).gratovo?.invoke ?? null;
}

function choose(id: string, choice: "mine" | "theirs"): void {
  const failed = (reason: unknown): void => {
    console.error("The conflict choice wasn't sent:", reason);
    toast({ msg: strings.saveFailed.title, sub: strings.saveFailed.sub, icon: "alert" });
  };
  const invoke = invoker();
  if (invoke === null) {
    failed("no bridge");
    return;
  }
  invoke("data:write", { writes: [{ kind: "conflict.resolve", id, choice }] }).then((result) => {
    if (!result.ok) {
      failed(result.reason);
    }
  }, failed);
}

/** A stage reads by its name ("Contact confirmed"), as everywhere else in the app; other values as they are. */
function shown(field: string, value: string): string {
  const stages: Readonly<Record<string, string>> = strings.record.stages;
  const text = field === "creator_stage" ? (stages[value] ?? value) : value;
  // A long note would fill the toast: each side is cut, as main's notice does.
  return text.length > shownMax ? `${text.slice(0, shownMax - 1)}…` : text;
}

/** Shows the choice for one open conflict: both values, and Use mine / Keep theirs. Nothing for an unknown id. */
export function showConflictChoice(id: string): void {
  const conflict = appStore()
    .getState()
    .data.conflicts.find((c) => c.id === id);
  if (conflict === undefined) {
    return;
  }
  const { conflicts: words } = strings;
  const field = words.fields[conflict.field] ?? conflict.field;
  toast({
    msg: words.toast(conflict.label, conflict.theirName),
    sub: words.sub(
      field,
      shown(conflict.field, conflict.mine),
      shown(conflict.field, conflict.theirs),
    ),
    icon: "alert",
    ms: choiceToastMs,
    actions: [
      {
        label: words.useMine,
        run: () => {
          choose(id, "mine");
        },
      },
      {
        label: words.keepTheirs,
        run: () => {
          choose(id, "theirs");
        },
      },
    ],
  });
}

/**
 * Shows the choice once for each conflict id that appears in the data (the ones already there when
 * this starts count as new, so a conflict left open from the last session asks again). A conflict
 * that goes and comes back asks again. Returns a function that stops it.
 */
export function installConflictToasts(invoke: Bridge["invoke"]): () => void {
  send = invoke;
  const shown = new Set<string>();
  const check = (): void => {
    const open: readonly EditConflict[] = appStore().getState().data.conflicts;
    const ids = new Set(open.map((c) => c.id));
    for (const id of shown) {
      if (!ids.has(id)) {
        shown.delete(id);
      }
    }
    for (const id of ids) {
      if (!shown.has(id)) {
        shown.add(id);
        showConflictChoice(id);
      }
    }
  };
  check();
  const stop = subscribeApp(check);
  return () => {
    stop();
    if (send === invoke) {
      send = null;
    }
  };
}
