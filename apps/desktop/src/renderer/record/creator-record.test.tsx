// @vitest-environment happy-dom
import { formatCount, type Fit } from "@gratovo/core/find";
import type { LogEntry } from "@gratovo/core/data";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RecordBody } from "../overlays/record-summary";
import { RecordPage } from "../app/record-page";
import { useGlobalKeys, useKeyListener } from "../app/global-keys";
import { aiChannel } from "../lib/find-test-bridge";
import { appStore, resetAppStoreForTests } from "../lib/store";
import { peek } from "../lib/actions";
import { Peek } from "../overlays/peek";
import { shortDate } from "../lib/format";
import { strings } from "../strings";
import { CreatorRecord } from "./creator-record";
import type { CreatorDetail } from "./detail";
import { channelUrl, videoUrl } from "./detail";

const t = strings.creatorRecord;
const channelId = "UCabcdefghijklmnopqrstuv";
const noteId = "UCnnnnnnnnnnnnnnnnnnnnnn";
const chA = "UCaaaaaaaaaaaaaaaaaaaaaa";
const chB = "UCbbbbbbbbbbbbbbbbbbbbbb";
const fit: Fit = {
  score: 72,
  parts: [
    { key: "median", points: 20, of: 30, note: "41K median" },
    { key: "posting", points: 15, of: 20, note: "6 uploads" },
    { key: "audience", points: 12, of: 15, note: "US" },
    { key: "engagement", points: 0, of: 20, note: "not known" },
    { key: "sponsored", points: 15, of: 15, note: "Notion AI" },
  ],
};

function detail(id: string, over: Partial<CreatorDetail> = {}): CreatorDetail {
  return {
    ...aiChannel(id, "Agent Lab"),
    fit,
    description: "We test AI agents.",
    notes: "",
    notesCut: false,
    ...over,
  } as CreatorDetail;
}

interface Fixture {
  items?: Record<string, CreatorDetail | null>;
  lines?: LogEntry[];
  writeOk?: boolean;
  itemFails?: boolean;
  /** `toolbox:restore` answers only after this settles. */
  holdRestore?: Promise<unknown>;
}
type Call = [string, unknown];
let handlers: ((event: string) => void)[] = [];
let calls: Call[] = [];

function bridge(fixture: Fixture): void {
  calls = [];
  handlers = [];
  const invoke = (channel: string, input: unknown) => {
    calls.push([channel, input]);
    switch (channel) {
      case "find:item": {
        if (fixture.itemFails === true) return Promise.resolve({ ok: false, reason: "test" });
        const found = fixture.items?.[(input as { id: string }).id] ?? null;
        return Promise.resolve({ ok: true, value: { item: found } });
      }
      case "log:for":
        return Promise.resolve({ ok: true, value: { lines: fixture.lines ?? [] } });
      case "toolbox:restore":
        return (fixture.holdRestore ?? Promise.resolve()).then(() => ({
          ok: true,
          value: { ok: true, restored: 1, refetch: false },
        }));
      case "data:write":
        return Promise.resolve(fixture.writeOk === false ? { ok: false } : { ok: true, value: {} });
      default:
        return Promise.resolve({ ok: false, reason: "test" });
    }
  };
  const on = (event: string, handler: () => void) => {
    const h = (e: string): void => {
      if (e === event) handler();
    };
    handlers.push(h);
    return () => undefined;
  };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: invoke as unknown as Bridge["invoke"],
    on: on as unknown as Bridge["on"],
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function show(id: string, fixture: Fixture, layout: "peek" | "page" = "peek"): Promise<void> {
  bridge(fixture);
  render(<CreatorRecord id={id} layout={layout} />);
  await settle();
}

const creatorOf = (id: string) =>
  appStore()
    .getState()
    .data.creators.find((c) => c.id === id);
const click = async (el: HTMLElement): Promise<void> => {
  fireEvent.click(el);
  await settle();
};
const tab = (name: string) => screen.getByRole("tab", { name });

beforeEach(() => {
  resetAppStoreForTests({ screen: "find", tab: "triage" });
});
afterEach(cleanup);

describe("links", () => {
  it("builds YouTube links from good ids only", () => {
    expect(channelUrl(channelId)).toBe(`https://www.youtube.com/channel/${channelId}`);
    expect(channelUrl("UCshort")).toBeNull();
    expect(channelUrl(`${channelId}"><script>`)).toBeNull();
    expect(videoUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(videoUrl("dQw4w9WgXc")).toBeNull();
    expect(videoUrl("dQw4w9WgX/Q")).toBeNull();
  });
});

describe("the header", () => {
  it("shows a skeleton first, then the channel", async () => {
    bridge({ items: { [channelId]: detail(channelId) } });
    render(<CreatorRecord id={channelId} layout="peek" />);
    expect(screen.getByRole("status", { name: t.loading })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    await settle();
    expect(screen.queryByRole("status", { name: t.loading })).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Agent Lab");
    expect(screen.getByText("@agentlab")).toBeTruthy();
    expect(screen.getByText(strings.record.stages.new)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fit 72" })).toBeTruthy();
    const link = screen.getByRole("link", { name: t.openOnYouTube });
    expect(link.getAttribute("href")).toBe(`https://www.youtube.com/channel/${channelId}`);
  });

  it("has no channel link when the id is not a channel id", async () => {
    await show("UC-short", { items: { "UC-short": detail("UC-short") } });
    expect(screen.queryByRole("link", { name: t.openOnYouTube })).toBeNull();
  });

  it("says so when the channel is not in the data", async () => {
    await show("UC-gone", { items: {} });
    expect(screen.getByText(t.notFound)).toBeTruthy();
  });

  it("a failed load is not 'not found': it offers Try again", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a") }, itemFails: true });
    expect(screen.getByText(t.loadFailed)).toBeTruthy();
    expect(screen.queryByText(t.notFound)).toBeNull();
    bridge({ items: { "UC-a": detail("UC-a") } });
    await click(screen.getByRole("button", { name: t.retry }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Agent Lab");
  });
});

describe("the next step", () => {
  it("new: Shortlist shortlists", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a") } });
    await click(screen.getByRole("button", { name: t.shortlist }));
    expect(creatorOf("UC-a")?.stage).toBe("shortlisted");
  });

  it("new: Reject asks for a reason first", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a") } });
    expect(screen.queryByRole("group", { name: t.rejectWhy })).toBeNull();
    await click(screen.getByRole("button", { name: t.reject }));
    const group = screen.getByRole("group", { name: t.rejectWhy });
    await click(within(group).getByRole("button", { name: strings.findActions.reasons.views }));
    expect(creatorOf("UC-a")).toMatchObject({ stage: "rejected", rejectReason: "views" });
  });

  it("shortlisted: Confirm an address opens the contact block, and confirming moves on", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a", { stage: "shortlisted" }) } });
    expect(screen.getByText(t.next.confirmHint)).toBeTruthy();
    const toggle = screen.getByRole("button", { name: t.next.confirmAddress });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const block = strings.findContacts.block;
    expect(screen.getByRole("radiogroup", { name: block.listLabel })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(block.nameLabel), { target: { value: "Sam" } });
    await click(screen.getAllByRole("button", { name: block.confirm })[0] as HTMLElement);
    expect(creatorOf("UC-a")).toMatchObject({
      stage: "contact",
      email: "biz@agentlab.ai",
      contactName: "Sam",
    });
    expect(screen.getByText(t.next.contactConfirmed("biz@agentlab.ai"))).toBeTruthy();
    expect(screen.getByText(t.next.contactHint("Sam"))).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(document.activeElement?.textContent).toBe(t.next.contactConfirmed("biz@agentlab.ai"));
  });

  it("contact: Change opens the list again", async () => {
    await show("UC-a", {
      items: {
        "UC-a": detail("UC-a", {
          stage: "contact",
          email: "biz@agentlab.ai",
          emailConfirmed: true,
          contactName: null,
        }),
      },
    });
    expect(screen.getByText(t.next.contactConfirmed("biz@agentlab.ai"))).toBeTruthy();
    expect(screen.getByText(t.next.contactHint(null))).toBeTruthy();
    await click(screen.getByRole("button", { name: strings.findContacts.block.change }));
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("rejected: shows the reason and Bring back", async () => {
    await show("UC-a", {
      items: { "UC-a": detail("UC-a", { stage: "rejected", rejectReason: "ai" }) },
    });
    expect(screen.getByText(t.next.rejectedLine(strings.findActions.reasons.ai))).toBeTruthy();
    await click(screen.getByRole("button", { name: t.bringBack }));
    expect(creatorOf("UC-a")?.stage).toBe("new");
  });

  it("rejected and archived for good: Bring back also restores the channel", async () => {
    await show("UC-a", {
      items: {
        "UC-a": detail("UC-a", { stage: "rejected", rejectReason: "ai", archivedAt: 1_000 }),
      },
    });
    await click(screen.getByRole("button", { name: t.bringBack }));
    expect(creatorOf("UC-a")?.stage).toBe("new");
    expect(calls.filter(([c]) => c === "toolbox:restore")).toEqual([
      ["toolbox:restore", { ids: ["UC-a"] }],
    ]);
  });

  it("rejected and archived for good: Bring back waits while the restore runs", async () => {
    let release: () => void = () => undefined;
    const holdRestore = new Promise<void>((resolve) => {
      release = resolve;
    });
    await show("UC-a", {
      items: {
        "UC-a": detail("UC-a", { stage: "rejected", rejectReason: "ai", archivedAt: 1_000 }),
      },
      holdRestore,
    });
    const button = screen.getByRole("button", { name: t.bringBack });
    await click(button);
    expect(button.hasAttribute("disabled")).toBe(true);
    await click(button);
    expect(calls.filter(([c]) => c === "toolbox:restore")).toHaveLength(1);
    release();
    await act(async () => {
      await holdRestore;
    });
  });

  it("rejected, not archived: Bring back never asks main to restore", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a", { stage: "rejected" }) } });
    await click(screen.getByRole("button", { name: t.bringBack }));
    expect(calls.filter(([c]) => c === "toolbox:restore")).toHaveLength(0);
  });

  it("never: Allow again needs a yes, and Keep blocked changes nothing", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a", { stage: "never" }) } });
    expect(screen.getAllByText(t.next.neverLine).length).toBeGreaterThan(0);
    await click(screen.getByRole("button", { name: t.next.allow }));
    await click(screen.getByRole("button", { name: t.next.allowKeep }));
    expect(creatorOf("UC-a")).toBeUndefined();
    await click(screen.getByRole("button", { name: t.next.allow }));
    await click(screen.getByRole("button", { name: t.next.allowYes }));
    expect(creatorOf("UC-a")?.stage).toBe("new");
  });

  it("a later stage shows the stage name only", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a", { stage: "emailed" }) } });
    expect(screen.getAllByText(strings.record.stages.emailed).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: t.shortlist })).toBeNull();
  });
});

describe("the tabs", () => {
  it("move with the arrow keys and keep one tab in the Tab order", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a") } });
    expect(tab(t.tabs.overview).getAttribute("tabindex")).toBe("0");
    expect(tab(t.tabs.notes).getAttribute("tabindex")).toBe("-1");
    tab(t.tabs.overview).focus();
    fireEvent.keyDown(tab(t.tabs.overview), { key: "ArrowRight" });
    expect(tab(t.tabs.emails).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab(t.tabs.emails), { key: "ArrowRight" });
    expect(tab(t.tabs.notes).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab(t.tabs.notes));
    fireEvent.keyDown(tab(t.tabs.notes), { key: "End" });
    expect(tab(t.tabs.activity).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab(t.tabs.activity), { key: "ArrowRight" });
    expect(tab(t.tabs.overview).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab(t.tabs.overview), { key: "ArrowLeft" });
    expect(tab(t.tabs.activity).getAttribute("aria-selected")).toBe("true");
  });
});

describe("the Emails tab", () => {
  it("opens on the tab it is asked for, and says so when the emails can't be read", async () => {
    bridge({ items: { "UC-a": detail("UC-a") } });
    render(<CreatorRecord id="UC-a" layout="peek" tab="emails" />);
    await settle();
    expect(tab(t.tabs.emails).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(strings.reach.emails.loadFailed)).toBeTruthy();
    expect(calls).toContainEqual(["reach:thread", { creatorId: "UC-a" }]);
  });

  it("opens on Overview when the tab is not one of its tabs", async () => {
    bridge({ items: { "UC-a": detail("UC-a") } });
    render(<CreatorRecord id="UC-a" layout="page" tab="nope" />);
    await settle();
    expect(tab(t.tabs.overview).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Overview", () => {
  it("shows the numbers, 6 videos as links, fit parts, sponsors and addresses", async () => {
    const videos: CreatorDetail["videos"][number][] = Array.from({ length: 9 }, (_, i) => ({
      id: `video${String(i).padStart(6, "0")}`,
      title: `Agent video ${String(i)}`,
      views: 1000 * (i + 1),
      publishedAt: Date.now() - i * 86_400_000,
      pic: null,
    }));
    videos[1] = { id: "bad/id", title: "Bad id", views: 1, publishedAt: null, pic: null };
    await show("UC-a", { items: { "UC-a": detail("UC-a", { videos }) } });
    expect(screen.getByText(formatCount(41_000))).toBeTruthy();
    expect(screen.getByText(formatCount(120_000))).toBeTruthy();
    const links = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.includes("watch?v="));
    expect(links).toHaveLength(5);
    expect(links[0]?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=video000000");
    expect(screen.getByText("Agent video 5")).toBeTruthy();
    expect(screen.queryByText("Agent video 6")).toBeNull();
    expect(screen.getByText("41K median")).toBeTruthy();
    expect(
      within(screen.getByText(t.sponsors).parentElement as HTMLElement).getByText("Notion AI"),
    ).toBeTruthy();
    expect(screen.getByText(t.addresses(2))).toBeTruthy();
    expect(screen.getByText(/“ai agents”/)).toBeTruthy();
  });

  it("cuts the description at 600 characters until Show all", async () => {
    const description = `${"a".repeat(590)}\n${"b".repeat(100)}`;
    await show("UC-a", { items: { "UC-a": detail("UC-a", { description }) } });
    const body = (): string => document.querySelector(".cr-desc")?.textContent ?? "";
    expect(body()).toHaveLength(600);
    await click(screen.getByRole("button", { name: t.showAll }));
    expect(body()).toBe(description);
    await click(screen.getByRole("button", { name: t.showLess }));
    expect(body()).toHaveLength(600);
  });

  it("says what is missing for a channel without numbers", async () => {
    await show("UC-a", {
      items: { "UC-a": detail("UC-a", { hasNumbers: false, videos: [] }) },
    });
    expect(screen.getByText(t.noNumbers)).toBeTruthy();
    expect(screen.getByText(t.noVideos)).toBeTruthy();
  });

  it("copes with the worst case without overflow classes breaking", async () => {
    const videos = Array.from({ length: 15 }, (_, i) => ({
      id: `worstvideo${String(i % 10)}`,
      title: "T".repeat(200),
      views: null,
      publishedAt: null,
      pic: null,
    }));
    const worst = detail("UC-a", {
      name: "N".repeat(120),
      subscribers: null,
      sponsors: Array.from({ length: 50 }, (_, i) => `Sponsor AI Tool ${String(i)}`),
      description: "d".repeat(5000),
      videos,
    });
    await show("UC-a", { items: { "UC-a": worst } }, "page");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toHaveLength(120);
    expect(screen.getByText(t.numbers.hidden)).toBeTruthy();
    expect(document.querySelectorAll(".cr-vids .vid")).toHaveLength(6);
    expect(document.querySelectorAll(".cr-tags .tag")).toHaveLength(50);
    expect(document.querySelector(".cr")?.getAttribute("data-layout")).toBe("page");
  });
});

describe("Notes", () => {
  const notesBox = (): HTMLTextAreaElement => screen.getByLabelText(t.notesLabel);
  const writes = (): Call[] => calls.filter(([c]) => c === "data:write");

  it("saves on blur when changed, then flags Saved", async () => {
    await show(noteId, { items: { [noteId]: detail(noteId, { notes: "first" }) } });
    await click(tab(t.tabs.notes));
    fireEvent.change(notesBox(), { target: { value: "first, then more" } });
    expect(writes()).toHaveLength(0);
    fireEvent.blur(notesBox());
    await settle();
    expect(writes()).toEqual([
      [
        "data:write",
        {
          writes: [
            {
              kind: "creator.notes",
              id: noteId,
              notes: "first, then more",
              base: "first",
              handle: "@agentlab",
              name: "Agent Lab",
            },
          ],
        },
      ],
    ]);
    expect(screen.getByRole("status", { name: "" }).textContent).toBe(t.notesSaved);
  });

  it("does not save when nothing changed", async () => {
    await show(noteId, { items: { [noteId]: detail(noteId, { notes: "same" }) } });
    await click(tab(t.tabs.notes));
    fireEvent.blur(notesBox());
    await settle();
    expect(writes()).toHaveLength(0);
  });

  it("toasts when the save fails and keeps the text", async () => {
    await show(noteId, { items: { [noteId]: detail(noteId) }, writeOk: false });
    await click(tab(t.tabs.notes));
    fireEvent.change(notesBox(), { target: { value: "lost?" } });
    fireEvent.blur(notesBox());
    await settle();
    expect(
      appStore()
        .getState()
        .ui.toasts.map((x) => x.msg),
    ).toContain(t.notesFailed);
    expect(notesBox().value).toBe("lost?");
  });

  it("is read-only when the stored note was cut", async () => {
    await show(noteId, {
      items: { [noteId]: detail(noteId, { notes: "long note", notesCut: true }) },
    });
    await click(tab(t.tabs.notes));
    expect(notesBox().readOnly).toBe(true);
    expect(screen.getByText(t.notesCut)).toBeTruthy();
    fireEvent.blur(notesBox());
    await settle();
    expect(writes()).toHaveLength(0);
  });

  it("is read-only for an id that is not a channel id", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a") } });
    await click(tab(t.tabs.notes));
    expect(notesBox().readOnly).toBe(true);
    expect(screen.getByText(t.notesChannelOnly)).toBeTruthy();
  });

  it("saves on Esc through the peek, with the text it started from", async () => {
    bridge({ items: { [chA]: detail(chA, { notes: "old" }) } });
    render(
      <>
        <Keys />
        <Peek />
      </>,
    );
    act(() => {
      peek({ kind: "creator", id: chA }, [chA, chB]);
    });
    await settle();
    await click(tab(t.tabs.notes));
    notesBox().focus();
    fireEvent.change(notesBox(), { target: { value: "old and new" } });
    fireEvent.keyDown(document, { key: "Escape" });
    await settle();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.[1]).toMatchObject({
      writes: [{ kind: "creator.notes", id: chA, notes: "old and new", base: "old" }],
    });
  });

  it("saves on Alt+Down for the creator it was typed on", async () => {
    bridge({ items: { [chA]: detail(chA), [chB]: detail(chB, { name: "Prompt Garage" }) } });
    render(
      <>
        <Keys />
        <Peek />
      </>,
    );
    act(() => {
      peek({ kind: "creator", id: chA }, [chA, chB]);
    });
    await settle();
    await click(tab(t.tabs.notes));
    fireEvent.change(notesBox(), { target: { value: "for the first" } });
    fireEvent.keyDown(document, { key: "ArrowDown", altKey: true });
    await settle();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.[1]).toMatchObject({
      writes: [{ id: chA, notes: "for the first", base: "" }],
    });
  });

  it("keeps an unsaved draft when the stored note changes, and says so", async () => {
    const items: Record<string, CreatorDetail | null> = {
      [noteId]: detail(noteId, { notes: "one" }),
    };
    await show(noteId, { items });
    await click(tab(t.tabs.notes));
    fireEvent.change(notesBox(), { target: { value: "mine" } });
    items[noteId] = detail(noteId, { notes: "theirs" });
    act(() => {
      for (const h of handlers) h("find:catalog");
    });
    await settle();
    expect(notesBox().value).toBe("mine");
    expect(screen.getByText(t.notesChanged)).toBeTruthy();
    fireEvent.blur(notesBox());
    await settle();
    expect(writes()[0]?.[1]).toMatchObject({ writes: [{ notes: "mine", base: "one" }] });
  });

  it("counts characters left near the limit", async () => {
    await show(noteId, { items: { [noteId]: detail(noteId) } });
    await click(tab(t.tabs.notes));
    expect(screen.queryByText(/characters left/)).toBeNull();
    fireEvent.change(notesBox(), { target: { value: "x".repeat(49_500) } });
    expect(screen.getByText(t.notesLeft(500))).toBeTruthy();
  });
});

describe("Activity", () => {
  const me = (): string => appStore().getState().data.me;
  const line = (id: string, text: string, at: number): LogEntry => ({
    id,
    at,
    who: me(),
    text,
    ref: "UC-a",
    action: null,
    detail: null,
  });

  it("groups lines by day, newest first, with who and time", async () => {
    const now = Date.now();
    const old = now - 3 * 86_400_000;
    await show("UC-a", {
      items: { "UC-a": detail("UC-a") },
      lines: [
        line("1", "Agent Lab shortlisted", now),
        line("2", "Agent Lab rejected", now - 1000),
        line("3", "Agent Lab brought back", old),
      ],
    });
    await click(tab(t.tabs.activity));
    expect(calls).toContainEqual(["log:for", { ref: "UC-a", limit: 50 }]);
    const days = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(days).toContain(t.today);
    expect(days).toContain(shortDate(old));
    expect(screen.getAllByRole("listitem").map((li) => li.firstElementChild?.textContent)).toEqual(
      expect.arrayContaining(["Agent Lab shortlisted", "Agent Lab rejected"]),
    );
    const name = appStore()
      .getState()
      .data.team.find((m) => m.id === me())?.name;
    expect(screen.getAllByText(new RegExp(`^${name ?? "?"} · `)).length).toBe(3);
  });

  it("shows an old-app name as it is, and Someone only for a stray id", async () => {
    const at = Date.now();
    const old = (id: string, who: string): LogEntry => ({ ...line(id, "x", at), who });
    await show("UC-a", {
      items: { "UC-a": detail("UC-a") },
      lines: [old("1", "Sara"), old("2", "0b9d3f52-6c1e-4a7e-9a55-3f1c2d4e5f60")],
    });
    await click(tab(t.tabs.activity));
    expect(screen.getByText(new RegExp(`^Sara · `))).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${t.someone} · `))).toBeTruthy();
  });

  it("keeps the panel for the tab, and asks only while Activity is shown", async () => {
    await show("UC-a", { items: { "UC-a": detail("UC-a") } });
    const panel = document.getElementById(tab(t.tabs.activity).getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(calls.filter(([c]) => c === "log:for")).toHaveLength(0);
    act(() => {
      for (const h of handlers) h("find:catalog");
    });
    await settle();
    expect(calls.filter(([c]) => c === "log:for")).toHaveLength(0);
  });

  it("says so when there are no changes, and asks again on find:catalog", async () => {
    await show(chA, { items: { [chA]: detail(chA) } });
    await click(tab(t.tabs.activity));
    expect(screen.getByText(t.activityNone)).toBeTruthy();
    const before = calls.filter(([c]) => c === "log:for").length;
    act(() => {
      for (const h of handlers) h("find:catalog");
    });
    await settle();
    expect(calls.filter(([c]) => c === "log:for").length).toBe(before + 1);
  });
});

function Keys() {
  useGlobalKeys();
  useKeyListener();
  return null;
}

describe("in the peek and on the record page", () => {
  it("the peek opens a creator, and Alt+Down steps to the next", async () => {
    bridge({
      items: {
        [chA]: detail(chA),
        [chB]: detail(chB, { name: "Prompt Garage" }),
      },
    });
    render(
      <>
        <Keys />
        <Peek />
      </>,
    );
    act(() => {
      peek({ kind: "creator", id: chA }, [chA, chB]);
    });
    await settle();
    const side = screen.getByRole("complementary", { name: strings.peek.label });
    expect(within(side).getByRole("heading", { level: 2 }).textContent).toBe("Agent Lab");
    fireEvent.keyDown(document, { key: "ArrowDown", altKey: true });
    await settle();
    expect(within(side).getByRole("heading", { level: 2 }).textContent).toBe("Prompt Garage");
  });

  it("the record page shows the creator with the page layout and a Back button", async () => {
    bridge({ items: { [chA]: detail(chA) } });
    render(<RecordPage record={{ kind: "creator", id: chA }} />);
    await settle();
    expect(screen.getByRole("button", { name: strings.record.back })).toBeTruthy();
    expect(document.querySelector(".cr")?.getAttribute("data-layout")).toBe("page");
  });
});

describe("example data", () => {
  it("keeps the full record for a channel id after an action adopts it", async () => {
    bridge({ items: { [chA]: detail(chA) } });
    render(<RecordBody record={{ kind: "creator", id: chA }} layout="peek" />);
    await settle();
    await click(screen.getByRole("button", { name: t.shortlist }));
    expect(creatorOf(chA)?.stage).toBe("shortlisted");
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Agent Lab");
  });

  it("shows the summary for an example creator id", async () => {
    bridge({ items: {} });
    render(<RecordBody record={{ kind: "creator", id: "c1" }} layout="peek" />);
    await settle();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(calls.filter(([c]) => c === "find:item")).toHaveLength(0);
  });
});
