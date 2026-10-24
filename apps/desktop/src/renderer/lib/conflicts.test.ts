import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { strings } from "../strings";
import { installConflictToasts, showConflictChoice } from "./conflicts";
import { adoptServerData } from "./persist";
import { appStore, resetAppStoreForTests } from "./store";
import type { EditConflict } from "./store";

const conflict = (id: string, over: Partial<EditConflict> = {}): EditConflict => ({
  id,
  creator: "UC1",
  label: "@aimaven",
  field: "creator_stage",
  mine: "emailed",
  theirs: "replied",
  theirName: "Sara",
  ...over,
});

const setConflicts = (list: readonly EditConflict[]): void => {
  adoptServerData((draft) => {
    draft.conflicts = list as typeof draft.conflicts;
  });
};
const toasts = () => appStore().getState().ui.toasts;
const okInvoke = () => vi.fn().mockResolvedValue({ ok: true, value: {} });

let stop: () => void = () => undefined;

beforeEach(() => {
  resetAppStoreForTests({ screen: "today", tab: null });
});
afterEach(() => {
  stop();
  stop = () => undefined;
});

describe("the conflict choice", () => {
  it("shows one toast for each new conflict, with both values", () => {
    stop = installConflictToasts(okInvoke());
    expect(toasts()).toHaveLength(0);
    setConflicts([conflict("c1")]);
    expect(toasts()).toHaveLength(1);
    const [t] = toasts();
    expect(t?.msg).toBe("Your change to @aimaven clashed with Sara's");
    // A stage reads by its name, as everywhere else in the app.
    expect(t?.sub).toBe("Stage: yours In sequence, theirs Replied");
    expect(t?.actions.map((a) => a.label)).toEqual([
      strings.conflicts.useMine,
      strings.conflicts.keepTheirs,
    ]);
    // The same list again, and an unrelated change, add nothing.
    setConflicts([conflict("c1")]);
    adoptServerData((draft) => {
      draft.myName = "Ana";
    });
    expect(toasts()).toHaveLength(1);
    setConflicts([conflict("c1"), conflict("c2")]);
    expect(toasts()).toHaveLength(2);
  });

  it("asks about a conflict that is already open when it starts", () => {
    setConflicts([conflict("c1")]);
    stop = installConflictToasts(okInvoke());
    expect(toasts()).toHaveLength(1);
  });

  it("sends the right write for each action", () => {
    const invoke = okInvoke();
    stop = installConflictToasts(invoke);
    setConflicts([conflict("c1")]);
    toasts()[0]?.actions[0]?.run();
    expect(invoke).toHaveBeenLastCalledWith("data:write", {
      writes: [{ kind: "conflict.resolve", id: "c1", choice: "mine" }],
    });
    toasts()[0]?.actions[1]?.run();
    expect(invoke).toHaveBeenLastCalledWith("data:write", {
      writes: [{ kind: "conflict.resolve", id: "c1", choice: "theirs" }],
    });
  });

  it("says the change wasn't saved when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const invoke = vi.fn().mockResolvedValue({ ok: false, reason: "boom" });
    stop = installConflictToasts(invoke);
    setConflicts([conflict("c1")]);
    toasts()[0]?.actions[0]?.run();
    await vi.waitFor(() => {
      expect(toasts().some((t) => t.msg === strings.saveFailed.title)).toBe(true);
    });
  });

  it("shows the choice again on request, and ignores an unknown id", () => {
    setConflicts([conflict("c1", { field: "notes_x" })]);
    showConflictChoice("c1");
    expect(toasts()[0]?.sub).toBe("notes_x: yours emailed, theirs replied");
    showConflictChoice("nope");
    expect(toasts()).toHaveLength(1);
  });
});

describe("long notes in the choice", () => {
  it("cuts each side to 120 characters", () => {
    stop = installConflictToasts(okInvoke());
    setConflicts([
      conflict("n1", { field: "notes", mine: "m".repeat(300), theirs: "t".repeat(121) }),
    ]);
    const sub = toasts()[0]?.sub ?? "";
    expect(sub).toBe(`Notes: yours ${"m".repeat(119)}…, theirs ${"t".repeat(119)}…`);
  });
});
