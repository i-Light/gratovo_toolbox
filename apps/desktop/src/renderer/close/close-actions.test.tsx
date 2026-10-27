// @vitest-environment happy-dom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { askMissing, decline, saveKit } from "../lib/close-actions";
import { stubReachBridge } from "../lib/reach-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { strings } from "../strings";
import { kitCreator, passingKit, seedCreators } from "./close-fixtures";

const t = strings.close.actions;

beforeEach(() => {
  resetAppStoreForTests({ screen: "close", tab: "roster" });
  seedCreators([kitCreator(passingKit())]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const last = () => appStore().getState().ui.toasts.at(-1);

describe("close actions", () => {
  it("saves with a plain toast, no guess about where they moved", async () => {
    stubReachBridge();
    expect(await saveKit("c1", { engagement: 5 })).toBe(true);
    expect(last()?.msg).toBe(t.kitSaved("Prompt Lab"));
    expect(last()?.sub).toBe(t.kitSavedSub);
  });

  it("a decline with no draft has no Review it and says so", async () => {
    stubReachBridge({
      "close:decline": { ok: true, draftId: null, before: "kit", skipped: [] },
    });
    expect(await decline("c1")).toBe(true);
    expect(last()?.sub).toBe(t.declinedNoDraftSub);
    expect(last()?.actions.map((a) => a.label)).toEqual([t.undo]);
  });

  it("Undo of a decline whose email already went out says so", async () => {
    stubReachBridge({
      "close:decline": { ok: true, draftId: "d1", before: "kit", skipped: [] },
      "close:decline-undo": { ok: true, kept: "sent" },
    });
    await decline("c1");
    last()
      ?.actions.find((a) => a.label === t.undo)
      ?.run();
    await vi.waitFor(() => {
      expect(last()?.msg).toBe(t.undoKept);
    });
  });

  it("Undo of an ask skips the draft straight through data:write", async () => {
    const bridge = stubReachBridge({ "close:ask": { ok: true, draftId: "d9" } });
    await askMissing("c1");
    last()
      ?.actions.find((a) => a.label === t.undo)
      ?.run();
    await vi.waitFor(() => {
      expect(bridge.writes).toEqual([
        [{ kind: "draft.state", id: "d9", state: "skipped", sendAt: null }],
      ]);
    });
  });

  it("no_thread says there is no email to answer", async () => {
    stubReachBridge({ "close:ask": { ok: false, problem: "no_thread" } });
    expect(await askMissing("c1")).toBe(false);
    expect(last()?.msg).toBe(t.noThread("Prompt Lab"));
  });
});
