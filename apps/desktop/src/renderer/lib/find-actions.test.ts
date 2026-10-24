import type { CatalogItem } from "@gratovo/core/find";
import type { DataWrite } from "@gratovo/core/data";
import type { Bridge, InvokeResult } from "@gratovo/ipc/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { strings } from "../strings";
import { setNotify, undo } from "./actions";
import {
  allowAgain,
  bringBack,
  confirmAddress,
  confirmMany,
  ensureCreators,
  neverContact,
  reject,
  shortlist,
} from "./find-actions";
import { installPersistence, persistenceIdle } from "./persist";
import { appStore, resetAppStoreForTests } from "./store";

const t = strings.findActions;
const now = new Date(2026, 9, 24, 10, 0, 0).getTime();

function item(id: string, name: string, stage: CatalogItem["stage"] = "new"): CatalogItem {
  return {
    id,
    name,
    handle: `@${name.toLowerCase().replace(/ /g, "")}`,
    pic: null,
    stage,
    emailConfirmed: false,
    email: null,
    contactName: null,
    subscribers: 120_000,
    medianViews: 40_000,
    uploads30: 6,
    country: "US",
    sponsors: [],
    emails: [],
    latestUploadAt: null,
    foundAt: null,
    run: 1,
    keyword: "ai tools",
    videos: [],
    engagement: null,
    emailedBefore: null,
    rejectReason: null,
    rejectedAt: null,
    neverReason: null,
    archiveDueAt: null,
    archivedAt: null,
    hasNumbers: true,
  };
}

const ada = item("UC-ada", "Ada AI Tools");
const bo = item("UC-bo", "Bo Builds Agents");

const data = () => appStore().getState().data;
const find = (id: string) => data().creators.find((c) => c.id === id);
const toasts = () => appStore().getState().ui.toasts;
const lines = () => data().log.filter((l) => l.ref !== null);

let writes: DataWrite[][] = [];
let uninstall: () => void = () => undefined;

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  resetAppStoreForTests({ screen: "find", tab: "triage" }, now);
  writes = [];
  const invoke = (_channel: string, input: unknown): Promise<InvokeResult<"data:write">> => {
    writes.push([...(input as { writes: DataWrite[] }).writes]);
    return Promise.resolve({ ok: true, value: {} });
  };
  uninstall = installPersistence(invoke as Bridge["invoke"]);
});

afterEach(async () => {
  await settle();
  expect(persistenceIdle()).toBe(true);
  uninstall();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("ensureCreators", () => {
  it("adds a channel the frame lacks, from its stored state, and writes nothing", async () => {
    const before = data().creators.length;
    ensureCreators([
      { ...ada, email: "ada@example.com", emailConfirmed: true, contactName: "Ada" },
      ada,
    ]);
    expect(data().creators).toHaveLength(before + 1);
    expect(find("UC-ada")).toEqual({
      id: "UC-ada",
      name: "Ada AI Tools",
      handle: "@adaaitools",
      stage: "new",
      email: "ada@example.com",
      emailConfirmed: true,
      contactName: "Ada",
      contactSource: null,
      contactConfidence: null,
      rejectReason: null,
      rejectedAt: null,
      neverReason: null,
      archiveDueAt: null,
    });
    await settle();
    expect(writes).toEqual([]);
  });

  it("keeps a creator the frame already holds", () => {
    const held = data().creators[0];
    expect(held).toBeDefined();
    const before = data().creators;
    ensureCreators([item(held?.id ?? "", "Other name", "signed")]);
    expect(data().creators).toBe(before);
  });

  it("survives the undo of an older change", () => {
    setNotify("reply", false);
    ensureCreators([ada]);
    undo();
    expect(find("UC-ada")).toBeDefined();
    expect(data().settings.notify).toEqual({});
  });
});

describe("shortlist", () => {
  it("shortlists a new channel with one log line and a toast with Undo", async () => {
    expect(shortlist([ada])).toBe(true);
    expect(find("UC-ada")?.stage).toBe("shortlisted");
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      ref: "UC-ada",
      action: "creator.shortlist",
      detail: null,
      text: t.shortlisted("Ada AI Tools"),
    });
    const toast = toasts().at(-1);
    expect(toast?.msg).toBe("Ada AI Tools shortlisted");
    expect(toast?.sub).toBe("Shortlisted channels wait for a confirmed address before any email.");
    expect(toast?.actions.map((a) => a.label)).toEqual([strings.actions.undo]);
    await settle();
    // The persister writes the stage first, so main holds the row before the line names it.
    expect(writes.flat()).toEqual([
      {
        kind: "creator.stage",
        id: "UC-ada",
        stage: "shortlisted",
        handle: "@adaaitools",
        name: "Ada AI Tools",
      },
      expect.objectContaining({ kind: "log.add", ref: "UC-ada", action: "creator.shortlist" }),
    ]);
  });

  it("writes one line per creator and names the count, skipping the wrong stages", () => {
    const signed = item("UC-sig", "Sia Signed", "signed");
    expect(shortlist([ada, bo, signed])).toBe(true);
    expect(find("UC-sig")?.stage).toBe("signed");
    expect(
      lines()
        .map((l) => l.ref)
        .sort(),
    ).toEqual(["UC-ada", "UC-bo"]);
    expect(toasts().at(-1)?.msg).toBe("2 shortlisted");
  });

  it("does nothing when no channel fits", () => {
    const before = data();
    expect(shortlist([item("UC-s", "Sia", "signed")])).toBe(false);
    expect(data().log).toBe(before.log);
    expect(toasts()).toHaveLength(0);
  });

  it("takes a rejected channel and clears its reason", () => {
    reject([ada], "views");
    shortlist([ada]);
    expect(find("UC-ada")).toMatchObject({
      stage: "shortlisted",
      rejectReason: null,
      rejectedAt: null,
    });
  });

  it("Undo puts the stage back and removes the lines", () => {
    shortlist([ada, bo]);
    undo();
    expect(find("UC-ada")?.stage).toBe("new");
    expect(find("UC-bo")?.stage).toBe("new");
    expect(lines()).toHaveLength(0);
  });
});

describe("reject", () => {
  it("rejects with the reason and the time, and names it in the toast", async () => {
    expect(reject([ada], "audience")).toBe(true);
    expect(find("UC-ada")).toMatchObject({
      stage: "rejected",
      rejectReason: "audience",
      rejectedAt: now,
    });
    expect(lines()[0]).toMatchObject({
      ref: "UC-ada",
      action: "creator.reject",
      detail: "audience",
    });
    const toast = toasts().at(-1);
    expect(toast?.msg).toBe("Ada AI Tools rejected");
    expect(toast?.sub).toBe(
      "Audience outside US, UK, CA or AU. Bring it back from Toolbox › Archive before it is archived for good.",
    );
    await settle();
    expect(writes.flat().find((w) => w.kind === "creator.stage")).toEqual({
      kind: "creator.stage",
      id: "UC-ada",
      stage: "rejected",
      handle: "@adaaitools",
      name: "Ada AI Tools",
      reason: "audience",
    });
  });

  it("rejects a shortlisted channel, several at once, but not a signed one", () => {
    shortlist([ada]);
    expect(reject([ada, bo, item("UC-s", "Sia", "signed")], "ai")).toBe(true);
    expect(lines().filter((l) => l.action === "creator.reject")).toHaveLength(2);
    expect(toasts().at(-1)?.msg).toBe("2 rejected");
  });

  it("Undo restores the stage and removes the lines", () => {
    reject([ada, bo], "posting");
    undo();
    expect(find("UC-ada")).toMatchObject({ stage: "new", rejectReason: null, rejectedAt: null });
    expect(lines()).toHaveLength(0);
  });
});

describe("bringBack", () => {
  it("returns a rejected channel to new and clears the reason", () => {
    reject([ada], "views");
    expect(bringBack(ada)).toBe(true);
    expect(find("UC-ada")).toMatchObject({ stage: "new", rejectReason: null, rejectedAt: null });
    expect(lines()[0]).toMatchObject({ ref: "UC-ada", action: "creator.restore", detail: null });
    expect(toasts().at(-1)?.msg).toBe("Ada AI Tools is back in Review new");
    expect(toasts().at(-1)?.sub).toBeUndefined();
  });

  it("skips a channel that is not rejected", () => {
    expect(bringBack(ada)).toBe(false);
    expect(lines()).toHaveLength(0);
  });
});

describe("neverContact and allowAgain", () => {
  it("marks never with the reason text and the time", () => {
    expect(neverContact(ada, "Asked us to stop")).toBe(true);
    expect(find("UC-ada")).toMatchObject({ stage: "never", rejectedAt: now });
    expect(lines()[0]).toMatchObject({
      action: "creator.never",
      detail: "Asked us to stop",
      ref: "UC-ada",
    });
    expect(toasts().at(-1)?.msg).toBe("Ada AI Tools will never be emailed");
    expect(toasts().at(-1)?.sub).toBe("Searches skip this channel.");
  });

  it("allows again only from never", () => {
    expect(allowAgain(ada)).toBe(false);
    neverContact(ada, "Asked us to stop");
    expect(neverContact(ada, "again")).toBe(false);
    expect(allowAgain(ada)).toBe(true);
    expect(find("UC-ada")).toMatchObject({ stage: "new", rejectedAt: null });
    expect(lines()[0]).toMatchObject({ action: "creator.allow" });
    expect(toasts().at(-1)?.msg).toBe("Ada AI Tools can be emailed again");
    expect(toasts().at(-1)?.sub).toBe("Back in Review new; searches no longer skip it.");
    undo();
    expect(find("UC-ada")?.stage).toBe("never");
  });
});

describe("confirmAddress and confirmMany", () => {
  const shortlisted = (it: CatalogItem): CatalogItem => ({ ...it, stage: "shortlisted" });
  const sure = { email: "biz@ada.ai", source: "about", confidence: 0.95 } as const;
  const c = strings.findContacts;

  it("confirms one address: fields, stage, one line, a toast with Undo, and the writes", async () => {
    expect(confirmAddress(shortlisted(ada), { ...sure, contactName: "  Sam  " })).toBe(true);
    expect(find("UC-ada")).toMatchObject({
      email: "biz@ada.ai",
      emailConfirmed: true,
      contactName: "Sam",
      contactSource: "about",
      contactConfidence: 0.95,
      stage: "contact",
    });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatchObject({
      ref: "UC-ada",
      action: null,
      text: c.logLine("Ada AI Tools"),
    });
    const toast = toasts().at(-1);
    expect(toast?.msg).toBe("Confirmed Ada AI Tools’s address");
    expect(toast?.sub).toBe("Ready for the first email.");
    expect(toast?.actions.map((a) => a.label)).toEqual([strings.actions.undo]);
    await settle();
    expect(writes.flat().map((w) => w.kind)).toEqual([
      "creator.contact",
      "creator.stage",
      "log.add",
    ]);
  });

  it("an empty name is none, and a long one is cut at 80", () => {
    confirmAddress(shortlisted(ada), { ...sure, contactName: "   " });
    expect(find("UC-ada")?.contactName).toBeNull();
    confirmAddress(shortlisted(bo), { ...sure, contactName: "x".repeat(200) });
    expect(find("UC-bo")?.contactName).toHaveLength(80);
  });

  it("keeps the stage of a channel that is not shortlisted", () => {
    const signed = item("UC-sig", "Sia Signed", "signed");
    confirmAddress(signed, { ...sure, contactName: "" });
    expect(find("UC-sig")).toMatchObject({ stage: "signed", emailConfirmed: true });
  });

  it("a typed address has source typed and no confidence; a bad one changes nothing", () => {
    const typed = { source: "typed", confidence: null, contactName: "" } as const;
    expect(confirmAddress(shortlisted(ada), { ...typed, email: "not an address" })).toBe(false);
    expect(confirmAddress(shortlisted(ada), { ...typed, email: `${"a".repeat(250)}@b.co` })).toBe(
      false,
    );
    expect(find("UC-ada")).toBeUndefined();
    expect(confirmAddress(shortlisted(ada), { ...typed, email: "me@ada.ai" })).toBe(true);
    expect(find("UC-ada")).toMatchObject({ contactSource: "typed", contactConfidence: null });
  });

  it("Undo puts every field, the stage and the line back", () => {
    confirmAddress(shortlisted(ada), { ...sure, contactName: "Sam" });
    undo();
    expect(find("UC-ada")).toMatchObject({
      email: null,
      emailConfirmed: false,
      contactName: null,
      contactSource: null,
      contactConfidence: null,
      stage: "shortlisted",
    });
    expect(lines()).toHaveLength(0);
  });

  it("confirmMany acts once for all: one toast, one undo, names empty", () => {
    expect(
      confirmMany([
        { item: shortlisted(ada), choice: { ...sure, contactName: "Sam" } },
        { item: shortlisted(bo), choice: { ...sure, email: "biz@bo.ai", contactName: "" } },
      ]),
    ).toBe(true);
    expect(find("UC-ada")).toMatchObject({ stage: "contact", contactName: null });
    expect(lines()).toHaveLength(2);
    expect(toasts().at(-1)?.msg).toBe("Confirmed 2 addresses");
    undo();
    expect(find("UC-bo")?.stage).toBe("shortlisted");
    expect(lines()).toHaveLength(0);
  });

  it("confirmMany skips an entry that is not an address and confirms the rest", () => {
    expect(
      confirmMany([
        { item: shortlisted(ada), choice: { ...sure, contactName: "" } },
        { item: shortlisted(bo), choice: { ...sure, email: "nope", contactName: "" } },
      ]),
    ).toBe(true);
    expect(find("UC-ada")?.stage).toBe("contact");
    expect(find("UC-bo")).toBeUndefined();
    expect(
      confirmMany([{ item: shortlisted(bo), choice: { ...sure, email: "nope", contactName: "" } }]),
    ).toBe(false);
  });
});
