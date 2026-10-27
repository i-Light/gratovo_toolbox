// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { kitCreator, passingKit, seedCreators } from "../close/close-fixtures";
import { strings } from "../strings";
import { undo } from "./actions";
import { askMissing, decline, sign } from "./close-actions";
import { stubReachBridge } from "./reach-test-bridge";
import { appStore, resetAppStoreForTests } from "./store";

const t = strings.close.actions;
const stage = (): string | undefined =>
  appStore()
    .getState()
    .data.creators.find((c) => c.id === "c1")?.stage;
const toasts = () => appStore().getState().ui.toasts;

beforeEach(() => {
  resetAppStoreForTests({ screen: "find", tab: "review" });
});
afterEach(() => {
  appStore().ui((ui) => {
    ui.toasts = [];
  });
});

describe("sign", () => {
  it("moves the stage to signed, and Undo brings it back", () => {
    seedCreators([kitCreator(passingKit(), "kit")]);
    expect(sign("c1")).toBe(true);
    expect(stage()).toBe("signed");
    expect(toasts().at(-1)?.msg).toBe(t.signedToast("Prompt Lab"));
    expect(
      toasts()
        .at(-1)
        ?.actions.map((a) => a.label),
    ).toContain(t.roster);
    undo();
    expect(stage()).toBe("kit");
  });

  it("refuses when the check does not pass or the stage is replied", () => {
    seedCreators([kitCreator(passingKit({ ageBand: null }), "kit")]);
    expect(sign("c1")).toBe(false);
    seedCreators([kitCreator(passingKit(), "replied")]);
    expect(sign("c1")).toBe(false);
    expect(stage()).toBe("replied");
  });
});

describe("decline", () => {
  it("sends close:decline and its Undo sends close:decline-undo with the answer's fields", async () => {
    seedCreators([kitCreator(passingKit(), "kit")]);
    const answer = { ok: true, draftId: "d9", before: "kit", skipped: ["d1", "d2"] };
    const bridge = stubReachBridge({ "close:decline": answer });
    expect(await decline("c1")).toBe(true);
    expect(bridge.calls[0]).toEqual(["close:decline", { creatorId: "c1" }]);
    const undoAction = toasts()
      .at(-1)
      ?.actions.find((a) => a.label === t.undo);
    undoAction?.run();
    await Promise.resolve();
    expect(bridge.calls[1]).toEqual([
      "close:decline-undo",
      { creatorId: "c1", draftId: "d9", before: "kit", skipped: ["d1", "d2"] },
    ]);
  });

  it("says so in plain words when main refuses", async () => {
    seedCreators([kitCreator(passingKit(), "kit")]);
    stubReachBridge({ "close:decline": { ok: false, problem: "wrong_state" } });
    expect(await decline("c1")).toBe(false);
    expect(toasts().at(-1)?.msg).toBe(t.problems.wrong_state);
  });
});

describe("askMissing", () => {
  it("tells the person when an email is already waiting", async () => {
    seedCreators([kitCreator(passingKit({ ageBand: null }), "replied")]);
    stubReachBridge({ "close:ask": { ok: false, problem: "draft_open" } });
    expect(await askMissing("c1")).toBe(false);
    expect(toasts().at(-1)?.msg).toBe(t.draftOpen);
  });

  it("toasts with Review it and Undo when the draft is made", async () => {
    seedCreators([kitCreator(passingKit({ ageBand: null }), "replied")]);
    stubReachBridge({ "close:ask": { ok: true, draftId: "d5" } });
    expect(await askMissing("c1")).toBe(true);
    expect(
      toasts()
        .at(-1)
        ?.actions.map((a) => a.label),
    ).toEqual([t.reviewIt, t.undo]);
  });
});
