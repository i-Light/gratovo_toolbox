import type { Sequence } from "@gratovo/core/data";
import { describe, expect, it } from "vitest";

import { strings } from "../strings";
import { aiDraft } from "../lib/reach-test-bridge";
import { aiCreator } from "./reach-fixtures";
import { cardInfo } from "./reach-view";

const now = Date.UTC(2026, 9, 25, 12, 0, 0);
const day = 86_400_000;

describe("cardInfo for In sequence", () => {
  it("says when the email went and promises no follow-up while there is no sequence", () => {
    const info = cardInfo(
      {
        creator: aiCreator("c1", "Agent Weekly", { stage: "emailed" }),
        draft: null,
        sequence: null,
        thread: { creator: "c1", count: 1, lastOutAt: now - 2 * day, lastIn: null, answered: true },
      },
      "seq",
      now,
      null,
    );
    expect(info.sub).not.toContain(strings.reach.board.sub.lastSent);
    expect(info.sub).toContain("2");
    expect(info.chip).toBeNull();
  });

  it("names the next follow-up when a sequence runs", () => {
    const sequence: Sequence = {
      creator: "c1",
      mailbox: "outreach1@gratovo.example",
      startedAt: now - day,
      steps: [{ n: 1, dueAt: now + 2 * day, state: "planned", sentAt: null }],
      stopped: null,
      parkUntil: null,
    };
    const info = cardInfo(
      {
        creator: aiCreator("c1", "Agent Weekly", { stage: "emailed" }),
        draft: null,
        sequence,
        thread: null,
      },
      "seq",
      now,
      null,
    );
    expect(info.chip).toEqual({ kind: "due", at: now + 2 * day });
  });

  it("shows a scheduled email with its send time", () => {
    const info = cardInfo(
      {
        creator: aiCreator("c1", "Agent Weekly", { stage: "contact" }),
        draft: aiDraft("d1", "c1", { state: "scheduled", sendAt: now + day }),
        sequence: null,
        thread: null,
      },
      "seq",
      now,
      null,
    );
    expect(info.sub).toContain(strings.reach.board.sub.scheduled);
    expect(info.chip).toEqual({ kind: "due", at: now + day });
    expect(info.action).toBeNull();
  });
});
