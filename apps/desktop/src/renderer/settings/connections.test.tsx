// @vitest-environment happy-dom
import type { ConnectionsStatus, ImportReport } from "@gratovo/ipc";
import type { Bridge } from "@gratovo/ipc/bridge";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetFirstRunForTests, useFirstRun } from "../app/first-run";
import { initPrefs } from "../lib/prefs";
import { exampleData } from "../lib/example-data";
import { appStore, initAppStore, resetAppStoreForTests, selectRoute } from "../lib/store";
import { strings } from "../strings";
import { resetConnectionsForTests } from "./connections/use-connections";
import { SettingsScreen } from "./settings-screen";

const text = strings.settings.connections;
const imp = strings.settings.importDialog;

const status = (patch: Partial<ConnectionsStatus> = {}): ConnectionsStatus => ({
  python: { state: "ready" },
  youtube: { state: "available" },
  gemini: {
    state: "stopped",
    addon: { state: "missing", version: null },
    browser: null,
    problem: null,
  },
  mailApp: { set: false },
  mailboxes: [
    {
      address: "ana@agency.test",
      dailyCap: 30,
      warmupStartedOn: null,
      health: "ok",
      checkedAt: "2026-10-24T09:30:00.000Z",
    },
  ],
  mail: { label: "gratovo", senderName: null },
  proxies: { count: 2, enabled: true, includeDirect: false },
  pacing: "normal",
  parallel: { enabled: false, maxWorkers: 4 },
  aws: { keys: false, enabled: false, regions: [] },
  course: { courseDir: null, videoDir: null, courseFound: false },
  sync: { state: "synced" },
  import: { state: "never", at: null, backup: null },
  ...patch,
});

const report = (patch: Partial<ImportReport> = {}): ImportReport => ({
  source: "C:\\old\\gratovo.db",
  tables: [
    { name: "channels", inOld: 120, toAdd: 100, already: 20 },
    { name: "notes", inOld: 5, toAdd: 5, already: 0 },
  ],
  skipped: [
    { name: "profiles", rows: 4, why: "synced" },
    { name: "deals", rows: 10, why: "synced" },
    { name: "_meta", rows: 1, why: "bookkeeping" },
    { name: "themes", rows: 2, why: "not-ported" },
  ],
  unsent: { outbox: 3, activity: 2 },
  settingsFiles: [
    { name: "run_config.json", found: true },
    { name: "settings.json", found: false },
  ],
  dryRun: true,
  backup: null,
  ...patch,
});

type Invoke = (channel: string, input: unknown) => Promise<unknown>;
let calls: [string, unknown][];
let listeners: Map<string, ((payload: unknown) => void)[]>;

function install(answers: Record<string, unknown>): void {
  calls = [];
  listeners = new Map();
  const invoke: Invoke = (channel, input) => {
    calls.push([channel, input]);
    const answer = answers[channel];
    const value =
      typeof answer === "function" ? (answer as (i: unknown) => unknown)(input) : answer;
    return Promise.resolve({ ok: true, value: value ?? {} });
  };
  (window as unknown as { gratovo: Bridge }).gratovo = {
    invoke: invoke as unknown as Bridge["invoke"],
    on: ((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((l) => l !== listener),
        );
      };
    }) as unknown as Bridge["on"],
  };
}

const emit = async (event: string, payload: unknown): Promise<void> => {
  await act(async () => {
    for (const listener of listeners.get(event) ?? []) {
      listener(payload);
    }
    await Promise.resolve();
  });
};
const sent = (channel: string): unknown[] => calls.filter(([c]) => c === channel).map(([, i]) => i);

async function show(): Promise<void> {
  resetAppStoreForTests({ screen: "settings", tab: "connections" });
  render(<SettingsScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
const click = async (el: HTMLElement): Promise<void> => {
  await act(async () => {
    fireEvent.click(el);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};
const button = (name: string | RegExp): HTMLElement => screen.getByRole("button", { name });
const row = (id: string): HTMLElement => {
  const el = document.getElementById(`set-${id}`);
  if (el === null) {
    throw new Error(`no row ${id}`);
  }
  return el;
};
const toastText = (): string =>
  appStore()
    .getState()
    .ui.toasts.map((t) => `${t.msg} ${t.sub ?? ""}`)
    .join(" | ");

beforeEach(() => {
  localStorage.clear();
  initPrefs();
  resetConnectionsForTests();
  resetFirstRunForTests();
});
afterEach(() => {
  cleanup();
});

describe("Connections: the overview and the rows", () => {
  it("says what isn't set up yet instead of claiming everything works", async () => {
    install({ "connections:status": status({ mailboxes: [] }) });
    await show();
    expect(
      screen.getByText(
        text.notSetUpCallout(
          [text.pieces.oldData, text.pieces.mailApp, text.pieces.mailboxes].join(", "),
        ),
      ),
    ).toBeTruthy();
    expect(screen.queryByText(text.goodCallout)).toBeNull();
  });

  it("puts what isn't set up under what needs a look", async () => {
    install({ "connections:status": status({ python: { state: "missing" } }) });
    await show();
    expect(screen.getByText(text.needsLook(text.pieces.python))).toBeTruthy();
    expect(
      screen.getByText(text.notSetUp([text.pieces.oldData, text.pieces.mailApp].join(", "))),
    ).toBeTruthy();
  });

  it("shows the good callout and every row when nothing needs a look", async () => {
    install({
      "connections:status": status({
        mailApp: { set: true },
        sync: { state: "synced" },
        import: { state: "done", at: "2026-10-24T09:00:00.000Z", backup: null },
      }),
    });
    await show();
    expect(screen.getByText(text.goodCallout)).toBeTruthy();
    for (const id of [
      "connOld",
      "connMailApp",
      "connMailboxes",
      "connMailSettings",
      "connGemini",
      "connCourse",
      "connYoutube",
      "connPython",
      "connProxies",
      "connPacing",
      "connAws",
      "connSync",
    ]) {
      expect(row(id).getAttribute("data-ui")).toMatch(/^settings\.connections\./);
    }
    expect(within(row("connOld")).getByText(new RegExp(`^${text.old.done(null)} `))).toBeTruthy();
    expect(within(row("connPython")).getByText(text.tags.ready)).toBeTruthy();
    expect(within(row("connYoutube")).getByText(text.tags.available)).toBeTruthy();
    expect(within(row("connProxies")).getByText("2 proxies")).toBeTruthy();
    expect(within(row("connSync")).getByText(text.sync.tags.synced)).toBeTruthy();
    expect(screen.queryByText(/Updates/)).toBeNull();
  });

  it("names the pieces that need a look", async () => {
    install({
      "connections:status": status({
        python: { state: "missing" },
        youtube: { state: "unavailable" },
        course: { courseDir: "C:\\course", videoDir: null, courseFound: false },
        mailboxes: [
          {
            address: "ana@agency.test",
            dailyCap: 30,
            warmupStartedOn: null,
            health: "signed-out",
            checkedAt: null,
          },
        ],
      }),
    });
    await show();
    expect(
      screen.getByText(
        text.needsLook(
          [text.pieces.python, text.pieces.youtube, text.pieces.gmail, text.pieces.course].join(
            ", ",
          ),
        ),
      ),
    ).toBeTruthy();
    expect(within(row("connCourse")).getByText(text.course.notFound)).toBeTruthy();
    expect(within(row("connPython")).getByText(text.tags.missing)).toBeTruthy();
    expect(within(row("connYoutube")).getByText(text.tags.notAvailable)).toBeTruthy();
    expect(within(row("connMailboxes")).getByText(text.tags.signedOut)).toBeTruthy();
  });

  it("follows connections:changed", async () => {
    install({ "connections:status": status() });
    await show();
    expect(within(row("connSync")).getByText(text.sync.tags.synced)).toBeTruthy();
    await emit("connections:changed", status({ sync: { state: "offline" } }));
    expect(within(row("connSync")).getByText(text.sync.tags.offline)).toBeTruthy();
    expect(screen.getByText(text.needsLook(text.pieces.sync))).toBeTruthy();
  });
});

describe("Connections: secrets are set only", () => {
  it("sends the Gmail app and clears the fields, never showing the values", async () => {
    install({
      "connections:status": status(),
      "connections:set": { ok: true },
    });
    await show();
    const id = within(row("connMailApp")).getByLabelText<HTMLInputElement>(text.mailApp.id);
    const secret = within(row("connMailApp")).getByLabelText<HTMLInputElement>(text.mailApp.secret);
    expect(id.type).toBe("password");
    expect(id.autocomplete).toBe("off");
    expect(secret.type).toBe("password");
    fireEvent.change(id, { target: { value: "client-id-123" } });
    fireEvent.change(secret, { target: { value: "client-secret-456" } });
    await click(within(row("connMailApp")).getByRole("button", { name: text.mailApp.save }));
    expect(sent("connections:set")).toEqual([
      { kind: "mail.client", id: "client-id-123", secret: "client-secret-456" },
    ]);
    expect(toastText()).toContain(text.mailApp.toast);
    expect(document.body.innerHTML).not.toContain("client-secret-456");
    expect(document.body.innerHTML).not.toContain("client-id-123");
    // The status now says it is set: no values, a Replace button, and empty fields when reopened.
    await emit("connections:changed", status({ mailApp: { set: true } }));
    expect(within(row("connMailApp")).getAllByText(text.tags.set).length).toBeGreaterThan(0);
    expect(within(row("connMailApp")).queryByLabelText(text.mailApp.id)).toBeNull();
    await click(button(text.replace));
    expect(screen.getByLabelText<HTMLInputElement>(text.mailApp.id).value).toBe("");
  });

  it("keeps the fields and says why when the save is refused", async () => {
    install({
      "connections:status": status(),
      "connections:set": { ok: false, reason: "no_data" },
    });
    await show();
    fireEvent.change(screen.getByLabelText(text.mailApp.id), { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText(text.mailApp.secret), { target: { value: "def" } });
    await click(within(row("connMailApp")).getByRole("button", { name: text.mailApp.save }));
    expect(toastText()).toContain(text.setReasons.no_data);
    expect(screen.getByLabelText<HTMLInputElement>(text.mailApp.id).value).toBe("abc");
  });

  it("replaces the proxy list and clears it, and the AWS keys with a check on the key id", async () => {
    install({
      "connections:status": status({ aws: { keys: false, enabled: false, regions: [] } }),
      "connections:set": { ok: true },
    });
    await show();
    await click(button(text.proxies.replace));
    const area = screen.getByLabelText(text.proxies.label);
    fireEvent.change(area, { target: { value: "http://u:p@a:1\n\nhttp://b:2 \n" } });
    await click(button(text.proxies.save));
    expect(sent("connections:set")).toEqual([
      { kind: "proxies.urls", urls: ["http://u:p@a:1", "http://b:2"] },
    ]);
    expect(document.body.innerHTML).not.toContain("u:p@a");
    await click(button(text.proxies.clear));
    expect(sent("connections:set")[1]).toEqual({ kind: "proxies.urls", urls: [] });

    const keyId = within(row("connAws")).getByLabelText(text.aws.accessKeyId);
    fireEvent.change(keyId, { target: { value: "lower" } });
    expect(within(row("connAws")).getByText(text.aws.keysBad)).toBeTruthy();
    expect(
      within(row("connAws")).getByRole<HTMLButtonElement>("button", { name: text.aws.save })
        .disabled,
    ).toBe(true);
    fireEvent.change(keyId, { target: { value: "AKIDEXAMPLEKEYID" } });
    fireEvent.change(within(row("connAws")).getByLabelText(text.aws.secretAccessKey), {
      target: { value: "s3cret" },
    });
    await click(within(row("connAws")).getByRole("button", { name: text.aws.save }));
    expect(sent("connections:set")[2]).toEqual({
      kind: "aws.keys",
      accessKeyId: "AKIDEXAMPLEKEYID",
      secretAccessKey: "s3cret",
    });
    expect((keyId as HTMLInputElement).value).toBe("");
  });
});

describe("Connections: Gmail mailboxes", () => {
  it("steps the daily cap within 10 and 50", async () => {
    install({
      "connections:status": status({
        mailboxes: [
          {
            address: "lo@a.test",
            dailyCap: 10,
            warmupStartedOn: null,
            health: "ok",
            checkedAt: null,
          },
          {
            address: "hi@a.test",
            dailyCap: 50,
            warmupStartedOn: "2026-10-01",
            health: "ok",
            checkedAt: null,
          },
          {
            address: "mid@a.test",
            dailyCap: 20,
            warmupStartedOn: null,
            health: "unknown",
            checkedAt: null,
          },
        ],
      }),
      "connections:set": { ok: true },
    });
    await show();
    expect((button(text.mailboxes.capDown("lo@a.test")) as HTMLButtonElement).disabled).toBe(true);
    expect((button(text.mailboxes.capUp("hi@a.test")) as HTMLButtonElement).disabled).toBe(true);
    await click(button(text.mailboxes.capUp("mid@a.test")));
    expect(sent("connections:set")).toEqual([
      { kind: "mailbox.update", address: "mid@a.test", dailyCap: 21, warmupStartedOn: null },
    ]);
    await click(button(text.mailboxes.capDown("hi@a.test")));
    expect(sent("connections:set")[1]).toEqual({
      kind: "mailbox.update",
      address: "hi@a.test",
      dailyCap: 49,
      warmupStartedOn: "2026-10-01",
    });
  });

  it("removes a mailbox only after a confirm", async () => {
    install({ "connections:status": status(), "connections:set": { ok: true } });
    await show();
    await click(button(`${text.remove} ana@agency.test`));
    expect(sent("connections:set")).toEqual([]);
    await click(button(text.mailboxes.removeYes));
    expect(sent("connections:set")).toEqual([
      { kind: "mailbox.remove", address: "ana@agency.test" },
    ]);
    expect(toastText()).toContain(text.mailboxes.removed("ana@agency.test"));
  });

  it("connects a mailbox, and says the reason when it fails", async () => {
    let answer: unknown = { ok: true, address: "new@agency.test" };
    install({ "connections:status": status(), "mail:connect": () => answer });
    await show();
    await click(button(text.mailboxes.connect));
    expect(sent("mail:connect")).toHaveLength(1);
    expect(toastText()).toContain(text.mailboxes.connected("new@agency.test"));
    for (const reason of ["denied", "no_client", "exchange_failed"] as const) {
      answer = { ok: false, reason };
      await click(button(text.mailboxes.connect));
      expect(toastText()).toContain(text.connectReasons[reason]);
    }
  });

  it("shows the waiting words while the browser step is open", async () => {
    let finish: (value: unknown) => void = () => undefined;
    install({ "connections:status": status() });
    const base = window.gratovo.invoke;
    (window as unknown as { gratovo: Bridge }).gratovo = {
      ...window.gratovo,
      invoke: ((channel: string, input: unknown) =>
        channel === "mail:connect"
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : base(channel as never, input as never)) as unknown as Bridge["invoke"],
    };
    await show();
    await click(button(text.mailboxes.connect));
    expect(screen.getByText(text.mailboxes.waiting)).toBeTruthy();
    await act(async () => {
      finish({ ok: true, value: { ok: false, reason: "timeout" } });
      await Promise.resolve();
    });
    expect(screen.queryByText(text.mailboxes.waiting)).toBeNull();
    expect(toastText()).toContain(text.connectReasons.timeout);
  });

  it("checks the mailboxes and shows each health", async () => {
    install({
      "connections:status": status(),
      "mail:check": {
        ok: true,
        mailboxes: [
          {
            address: "ana@agency.test",
            dailyCap: 30,
            warmupStartedOn: null,
            health: "signed-out",
            checkedAt: "2026-10-24T10:00:00.000Z",
          },
        ],
      },
    });
    await show();
    await click(button(text.mailboxes.check));
    expect(sent("mail:check")).toHaveLength(1);
    expect(within(row("connMailboxes")).getByText(text.tags.signedOut)).toBeTruthy();
  });

  it("saves the sender name and label", async () => {
    install({ "connections:status": status(), "connections:set": { ok: true } });
    await show();
    fireEvent.change(screen.getByLabelText(new RegExp(text.mailSettings.sender)), {
      target: { value: "Ana from Gratovo" },
    });
    await click(
      within(row("connMailSettings")).getByRole("button", { name: text.mailSettings.save }),
    );
    expect(sent("connections:set")).toEqual([
      { kind: "mail.settings", label: "gratovo", senderName: "Ana from Gratovo" },
    ]);
  });
});

describe("Connections: the Gemini bridge", () => {
  it("sends start, stop and open-window, and never a prompt", async () => {
    install({
      "connections:status": status(),
      "gemini:start": { ...status().gemini, state: "listening" },
      "gemini:stop": status().gemini,
      "gemini:open-window": { ...status().gemini, state: "listening" },
    });
    await show();
    expect(within(row("connGemini")).getByText(text.gemini.states.stopped)).toBeTruthy();
    expect(within(row("connGemini")).getByText(text.gemini.addon.missing)).toBeTruthy();
    expect(screen.getByText(text.gemini.hint)).toBeTruthy();
    await click(button(text.gemini.start));
    expect(within(row("connGemini")).getByText(text.gemini.states.listening)).toBeTruthy();
    await click(button(text.gemini.openWindow));
    expect(sent("gemini:open-window")).toEqual([{ browser: null }]);
    await click(button(text.gemini.stop));
    expect(calls.map(([c]) => c).filter((c) => c.startsWith("gemini:"))).toEqual([
      "gemini:start",
      "gemini:open-window",
      "gemini:stop",
    ]);
  });

  it("says the problem in words and follows gemini:state", async () => {
    install({
      "connections:status": status({
        gemini: {
          state: "failed",
          addon: { state: "disconnected", version: "0.3.3" },
          browser: "chrome",
          problem: "port_in_use",
        },
      }),
    });
    await show();
    expect(within(row("connGemini")).getByText(text.gemini.problems.port_in_use)).toBeTruthy();
    expect(within(row("connGemini")).getByText(text.gemini.states.failed)).toBeTruthy();
    expect(within(row("connGemini")).getByText(text.gemini.browser("chrome"))).toBeTruthy();
    await emit("gemini:state", {
      state: "listening",
      addon: { state: "connected", version: "0.3.3" },
      browser: "chrome",
      problem: null,
    });
    expect(within(row("connGemini")).getByText(text.gemini.addon.connected("0.3.3"))).toBeTruthy();
    expect(within(row("connGemini")).queryByText(text.gemini.problems.port_in_use)).toBeNull();
  });
});

describe("Connections: the course folder", () => {
  it("chooses a folder and clears it", async () => {
    install({
      "connections:status": status({
        course: { courseDir: "C:\\course", videoDir: null, courseFound: true },
      }),
      "connections:pick-folder": { path: "D:\\videos" },
      "connections:set": { ok: true },
    });
    await show();
    expect(screen.getByText(text.course.hint)).toBeTruthy();
    await click(button(`${text.choose} ${text.course.videoDir}`));
    expect(sent("connections:pick-folder")).toEqual([{ purpose: "videos" }]);
    expect(sent("connections:set")).toEqual([
      { kind: "course", courseDir: "C:\\course", videoDir: "D:\\videos" },
    ]);
    await click(button(`${text.clear} ${text.course.courseDir}`));
    expect(sent("connections:set")[1]).toEqual({ kind: "course", courseDir: null, videoDir: null });
  });

  it("saves nothing when the picker is cancelled", async () => {
    install({ "connections:status": status(), "connections:pick-folder": { path: null } });
    await show();
    await click(button(`${text.choose} ${text.course.courseDir}`));
    expect(sent("connections:set")).toEqual([]);
  });
});

describe("Connections: search routing", () => {
  it("sends the switches with every field", async () => {
    install({ "connections:status": status(), "connections:set": { ok: true } });
    await show();
    await click(within(row("connPacing")).getByRole("switch", { name: text.routing.parallel }));
    expect(sent("connections:set")).toEqual([
      {
        kind: "pipeline.settings",
        pacing: "normal",
        parallel: { enabled: true, maxWorkers: 4 },
        proxies: { enabled: true, includeDirect: false },
      },
    ]);
    await click(within(row("connPacing")).getByRole("button", { name: text.routing.fast }));
    expect((sent("connections:set")[1] as { pacing: string }).pacing).toBe("fast");
  });

  it("removes a region after a confirm and deploys after explaining the cost", async () => {
    install({
      "connections:status": status({
        aws: { keys: true, enabled: true, regions: ["us-east-1"] },
      }),
      "gateways:remove": { ok: true, removed: 1 },
      "gateways:deploy": { ok: true, deployed: ["eu-west-1", "ap-south-1"], failed: [] },
    });
    await show();
    await click(button(text.aws.removeRegion("us-east-1")));
    expect(sent("gateways:remove")).toEqual([]);
    await click(button(text.aws.removeYes));
    expect(sent("gateways:remove")).toEqual([{ region: "us-east-1" }]);

    const group = screen.getByRole("group", { name: text.aws.regionsLabel });
    await click(within(group).getByRole("button", { name: "eu-west-1" }));
    await click(within(group).getByRole("button", { name: "ap-south-1" }));
    await click(button(text.aws.deploy));
    expect(sent("gateways:deploy")).toEqual([]);
    expect(screen.getByText(text.aws.deploySub)).toBeTruthy();
    await click(button(text.aws.deployYes));
    expect(sent("gateways:deploy")).toEqual([{ regions: ["eu-west-1", "ap-south-1"] }]);
    expect(toastText()).toContain(text.aws.deployed(2));
  });

  it("says why a deploy was refused", async () => {
    install({
      "connections:status": status({ aws: { keys: true, enabled: false, regions: [] } }),
      "gateways:deploy": { ok: false, reason: "running" },
    });
    await show();
    await click(screen.getByRole("button", { name: "us-east-1" }));
    await click(button(text.aws.deploy));
    await click(button(text.aws.deployYes));
    expect(toastText()).toContain(text.gatewayReasons.running);
  });
});

describe("the import dialog", () => {
  const chooseAndCheck = async (): Promise<void> => {
    await show();
    await click(button(text.old.button));
    await click(button(imp.check));
  };

  it("walks from the file, to the report, to the progress, to the result", async () => {
    install({
      "connections:status": status(),
      "import:candidates": {
        candidates: [
          { path: "C:\\old\\gratovo.db", modifiedAt: "2026-10-20T08:00:00.000Z", size: 2_500_000 },
        ],
      },
      "import:dry-run": { ok: true, report: report() },
      "import:run": {
        ok: true,
        report: report({ dryRun: false, backup: "C:\\data\\backup.db" }),
        mail: { messages: 12, mailbox: "copied" },
        warnings: ["channel_names"],
      },
    });
    resetAppStoreForTests({ screen: "settings", tab: "connections" });
    await chooseAndCheck();
    expect(sent("import:candidates")).toHaveLength(1);
    expect(sent("import:dry-run")).toEqual([{ path: "C:\\old\\gratovo.db" }]);
    const dialog = screen.getByRole("dialog", { name: imp.title, hidden: true });
    expect(within(dialog).getByText(imp.toAdd(100, 20))).toBeTruthy();
    expect(within(dialog).getByText(imp.unsent(5))).toBeTruthy();
    expect(within(dialog).getByText(imp.skipWhy.synced)).toBeTruthy();
    expect(within(dialog).getByText(imp.skipWhy.bookkeeping)).toBeTruthy();
    expect(within(dialog).getByText(imp.skipWhy["not-ported"])).toBeTruthy();
    expect(within(dialog).getByText(imp.skippedLine(2, 14))).toBeTruthy();
    const rules = within(dialog).getByLabelText<HTMLInputElement>(imp.useRules);
    expect(rules.checked).toBe(true);
    await click(rules);

    await click(within(dialog).getByRole("button", { name: imp.run }));
    expect(sent("import:run")).toEqual([{ path: "C:\\old\\gratovo.db", useOldRules: false }]);
    expect(within(dialog).getByText(imp.resultTitle)).toBeTruthy();
    expect(within(dialog).getByText(imp.backup("C:\\data\\backup.db"))).toBeTruthy();
    expect(within(dialog).getByText(imp.untouched)).toBeTruthy();
    expect(within(dialog).getByText(imp.resultAdded(105))).toBeTruthy();
    expect(within(dialog).getByText(imp.warningsTitle)).toBeTruthy();
    expect(within(dialog).getByText(imp.warnings.channel_names)).toBeTruthy();
    expect(within(dialog).getByText(imp.resultMail(12))).toBeTruthy();
    expect(within(dialog).getByText(imp.resultMailbox.copied)).toBeTruthy();
  });

  it("says a failed settings copy and unapplied old rules once each", async () => {
    install({
      "connections:status": status(),
      "import:candidates": {
        candidates: [
          { path: "C:\\old\\gratovo.db", modifiedAt: "2026-10-20T08:00:00.000Z", size: 10 },
        ],
      },
      "import:dry-run": { ok: true, report: report({ unsent: { outbox: 0, activity: 0 } }) },
      "import:run": {
        ok: true,
        report: report({ dryRun: false, backup: "C:\\data\\backup.db" }),
        warnings: ["find_backup", "old_rules"],
      },
    });
    resetAppStoreForTests({ screen: "settings", tab: "connections" });
    await chooseAndCheck();
    const dialog = screen.getByRole("dialog", { name: imp.title, hidden: true });
    await click(within(dialog).getByRole("button", { name: imp.run }));
    expect(within(dialog).getByText(imp.warnings.find_backup)).toBeTruthy();
    expect(within(dialog).getByText(imp.warnings.old_rules)).toBeTruthy();
    // Only the old_rules line talks about the rules, so the dialog doesn't say it twice.
    expect(imp.warnings.find_backup).not.toMatch(/rules/i);
    expect(within(dialog).getAllByText(/old search rules/i)).toHaveLength(1);
  });

  it("shows live progress from import:progress while it runs", async () => {
    install({
      "connections:status": status(),
      "import:candidates": {
        candidates: [
          { path: "C:\\old\\gratovo.db", modifiedAt: "2026-10-20T08:00:00.000Z", size: 10 },
        ],
      },
      "import:dry-run": { ok: true, report: report({ unsent: { outbox: 0, activity: 0 } }) },
    });
    let finish: (value: unknown) => void = () => undefined;
    const base = window.gratovo.invoke;
    (window as unknown as { gratovo: Bridge }).gratovo = {
      ...window.gratovo,
      invoke: ((channel: string, input: unknown) =>
        channel === "import:run"
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : base(channel as never, input as never)) as unknown as Bridge["invoke"],
    };
    await chooseAndCheck();
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(within(dialog).queryByText(imp.unsent(5))).toBeNull();
    await click(within(dialog).getByRole("button", { name: imp.run }));
    await emit("import:progress", { table: "channels", done: 1, total: 4 });
    expect(within(dialog).getByText(imp.progress("channels"))).toBeTruthy();
    expect(
      within(dialog).getByRole("progressbar", { hidden: true }).getAttribute("aria-valuenow"),
    ).toBe("1");
    await act(async () => {
      finish({ ok: true, value: { ok: true, report: report({ dryRun: false }) } });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(within(dialog).getByText(imp.noBackup)).toBeTruthy();
    expect(within(dialog).queryByText(imp.warningsTitle)).toBeNull();
  });

  it("says a refusal in words and stays on the same step", async () => {
    install({
      "connections:status": status(),
      "import:candidates": {
        candidates: [
          { path: "C:\\x\\gratovo.db", modifiedAt: "2026-10-20T08:00:00.000Z", size: 10 },
        ],
      },
      "import:dry-run": { ok: false, reason: "no_channels" },
    });
    await chooseAndCheck();
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(within(dialog).getByText(imp.reasons.no_channels)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: imp.check })).toBeTruthy();
  });

  it("picks another file by hand", async () => {
    install({
      "connections:status": status(),
      "import:candidates": { candidates: [] },
      "import:pick": { path: "E:\\elsewhere\\gratovo.db" },
      "import:dry-run": { ok: false, reason: "example_data" },
    });
    await show();
    await click(button(text.old.button));
    expect(screen.getByText(imp.none)).toBeTruthy();
    await click(button(imp.chooseOther));
    await click(button(imp.check));
    expect(sent("import:dry-run")).toEqual([{ path: "E:\\elsewhere\\gratovo.db" }]);
    expect(screen.getByText(imp.reasons.example_data)).toBeTruthy();
  });
});

describe("first run", () => {
  function Probe() {
    useFirstRun();
    return null;
  }
  const goLive = (start: { screen: "find" | "today"; tab: string | null }): void => {
    initAppStore({ ...exampleData(Date.now()), source: "live" }, start);
  };
  const route = () => selectRoute(appStore().getState());

  it("moves a fresh live start to Connections once and tells the gate", async () => {
    install({ "connections:status": status() });
    goLive({ screen: "find", tab: "search" });
    const { rerender } = render(<Probe />);
    await flush();
    expect(route()).toMatchObject({ screen: "settings", tab: "connections" });
    expect(appStore().getState().ui.importState).toBe("never");
    expect(sent("connections:status")).toHaveLength(1);
    rerender(<Probe />);
    await flush();
    expect(sent("connections:status")).toHaveLength(1);
  });

  it("does not move a start that is somewhere else, and records an import that happened", async () => {
    install({
      "connections:status": status({
        import: { state: "done", at: "2026-10-01T00:00:00.000Z", backup: null },
      }),
    });
    goLive({ screen: "find", tab: "search" });
    render(<Probe />);
    await flush();
    expect(route()).toMatchObject({ screen: "find", tab: "search" });
    expect(appStore().getState().ui.importState).toBe("imported");
  });

  it("does nothing in example mode", async () => {
    install({ "connections:status": status() });
    resetAppStoreForTests({ screen: "today", tab: null });
    render(<Probe />);
    await flush();
    expect(sent("connections:status")).toEqual([]);
    expect(route().screen).toBe("today");
    expect(appStore().getState().ui.importState).toBe("unknown");
  });
});
