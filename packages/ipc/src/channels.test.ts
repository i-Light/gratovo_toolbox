import { describe, expect, it } from "vitest";

import { channels, isChannel, parseRequest, secretName, type Channel } from "./channels";

describe("parseRequest", () => {
  it("accepts a known channel with a valid request", () => {
    expect(parseRequest("app:ping", {})).toEqual({ ok: true, channel: "app:ping", value: {} });
  });

  it("refuses a channel that is not declared", () => {
    const parsed = parseRequest("fs:read", { path: "C:/Users" });
    expect(parsed).toEqual({ ok: false, reason: 'Unknown channel "fs:read"' });
  });

  it("refuses names inherited from Object, not only unknown ones", () => {
    expect(isChannel("toString")).toBe(false);
    expect(isChannel("__proto__")).toBe(false);
    expect(parseRequest("constructor", {}).ok).toBe(false);
  });

  it("refuses a request with keys the schema does not declare", () => {
    expect(parseRequest("app:ping", { extra: true }).ok).toBe(false);
  });

  it("refuses a request that is not an object", () => {
    expect(parseRequest("app:ping", "ping").ok).toBe(false);
    expect(parseRequest("app:ping", undefined).ok).toBe(false);
  });
});

describe("app:ping response", () => {
  const response = channels["app:ping"].response;

  it("accepts the version", () => {
    expect(response.safeParse({ ok: true, version: "0.0.0" }).success).toBe(true);
  });

  it("refuses an empty version or a failure", () => {
    expect(response.safeParse({ ok: true, version: "" }).success).toBe(false);
    expect(response.safeParse({ ok: false, version: "0.0.0" }).success).toBe(false);
  });
});

describe("secretName", () => {
  it("accepts lowercase words joined by dots or hyphens", () => {
    for (const name of ["gemini.api-key", "gmail.token.mailbox-1", "youtube"]) {
      expect(secretName.safeParse(name).success).toBe(true);
    }
  });

  it("refuses anything else", () => {
    const refused = [
      "",
      "Gemini",
      "a..b",
      "a.",
      "-a",
      "a b",
      "../x",
      "a/b",
      "__proto__",
      "x".repeat(101),
    ];
    for (const name of refused) {
      expect(secretName.safeParse(name).success).toBe(false);
    }
  });
});

describe("secrets:status", () => {
  it("takes a secret's name and answers whether it is set, never its value", () => {
    expect(parseRequest("secrets:status", { name: "gemini.api-key" }).ok).toBe(true);
    expect(parseRequest("secrets:status", { name: "../keys" }).ok).toBe(false);
    expect(channels["secrets:status"].response.safeParse({ set: true }).success).toBe(true);
    expect(
      channels["secrets:status"].response.safeParse({ set: true, value: "sk-test-000" }).success,
    ).toBe(false);
  });
});

describe("sync and presence channels", () => {
  it("declares sync:status, sync:now and presence:set", () => {
    expect(isChannel("sync:status")).toBe(true);
    expect(isChannel("sync:now")).toBe(true);
    expect(isChannel("presence:set")).toBe(true);
  });

  it("takes an empty request for the sync channels and refuses extras", () => {
    expect(parseRequest("sync:status", {}).ok).toBe(true);
    expect(parseRequest("sync:now", { force: true }).ok).toBe(false);
  });

  it("checks the screen on presence:set", () => {
    expect(parseRequest("presence:set", { screen: "team", idle: true }).ok).toBe(true);
    expect(parseRequest("presence:set", { screen: "nowhere", idle: true }).ok).toBe(false);
  });
});

// --- Step 4 channels ---

const report = {
  source: "C:/Users/owner/old/gratovo.db",
  tables: [{ name: "channels", inOld: 1200, toAdd: 800, already: 400 }],
  skipped: [
    { name: "creators", rows: 30, why: "synced" },
    { name: "sync_state", rows: 2, why: "bookkeeping" },
    { name: "news_items", rows: 90, why: "not-ported" },
  ],
  unsent: { outbox: 3, activity: 1 },
  settingsFiles: [
    { name: "run_config.json", found: true },
    { name: "settings.json", found: false },
  ],
  dryRun: false,
  backup: "C:/Users/owner/AppData/Roaming/Gratovo Toolbox/backups/pipeline-20261024T090000Z.db",
};

const gemini = {
  state: "listening",
  addon: { state: "connected", version: "0.4.0" },
  browser: "firefox",
  problem: null,
};

const status = {
  python: { state: "ready" },
  youtube: { state: "available" },
  gemini,
  mailApp: { set: true },
  mailboxes: [
    {
      address: "sam@example.com",
      dailyCap: 20,
      warmupStartedOn: "2026-10-01",
      health: "ok",
      checkedAt: "2026-10-24T09:00:00.000Z",
    },
  ],
  mail: { label: "Gratovo", senderName: "Sam" },
  proxies: { count: 3, enabled: true, includeDirect: false },
  pacing: "normal",
  parallel: { enabled: true, maxWorkers: 4 },
  aws: { keys: true, enabled: true, regions: ["us-east-1"] },
  course: { courseDir: "D:/course", videoDir: null, courseFound: true },
  sync: { state: "synced" },
  import: { state: "done", at: "2026-10-24T09:00:00.000Z", backup: null },
};

function accepts(channel: Channel, part: "request" | "response", value: unknown): boolean {
  return channels[channel][part].safeParse(value).success;
}

describe("rules:set", () => {
  const rules = {
    countries: ["US"],
    perKeyword: 200,
    sortBy: "upload_date",
    resultsType: "video",
    autoClean: {
      enabled: true,
      minSubscribers: 50_000,
      maxSubscribers: 2_000_000,
      belowMin: "sweep",
      aboveMax: "delay",
      label: "inactive",
    },
    minMedianViews: 5_000,
    minUploads30: null,
    archiveDays: 7,
  };

  it("takes the whole rules, with the median, uploads and archive rules", () => {
    expect(parseRequest("rules:set", { rules }).ok).toBe(true);
    expect(parseRequest("rules:set", { rules: { ...rules, minMedianViews: null } }).ok).toBe(true);
  });

  it("refuses missing or out-of-range new rules", () => {
    const noArchive: Record<string, unknown> = { ...rules };
    delete noArchive["archiveDays"];
    expect(parseRequest("rules:set", { rules: noArchive }).ok).toBe(false);
    expect(parseRequest("rules:set", { rules: { ...rules, archiveDays: 0 } }).ok).toBe(false);
    expect(parseRequest("rules:set", { rules: { ...rules, archiveDays: 91 } }).ok).toBe(false);
    expect(parseRequest("rules:set", { rules: { ...rules, minUploads30: -1 } }).ok).toBe(false);
    expect(parseRequest("rules:set", { rules: { ...rules, minUploads30: 10_001 } }).ok).toBe(false);
    expect(parseRequest("rules:set", { rules: { ...rules, minMedianViews: 1.5 } }).ok).toBe(false);
  });
});

describe("the import channels", () => {
  it("takes a path for a dry run, and a path and the old-rules choice for a run", () => {
    expect(parseRequest("import:dry-run", { path: "C:/old/gratovo.db" }).ok).toBe(true);
    expect(parseRequest("import:dry-run", { path: "" }).ok).toBe(false);
    expect(parseRequest("import:dry-run", { path: "x".repeat(1025) }).ok).toBe(false);
    expect(parseRequest("import:run", { path: "C:/old/gratovo.db", useOldRules: true }).ok).toBe(
      true,
    );
    expect(parseRequest("import:run", { path: "C:/old/gratovo.db" }).ok).toBe(false);
    expect(parseRequest("import:candidates", { folder: "C:/" }).ok).toBe(false);
  });

  it("answers a report or a reason", () => {
    expect(accepts("import:run", "response", { ok: true, report })).toBe(true);
    expect(
      accepts("import:dry-run", "response", {
        ok: true,
        report: { ...report, dryRun: true, backup: null },
      }),
    ).toBe(true);
    expect(accepts("import:run", "response", { ok: false, reason: "no_channels" })).toBe(true);
    expect(accepts("import:run", "response", { ok: false, reason: "old_app_open" })).toBe(true);
    expect(accepts("import:run", "response", { ok: false, reason: "nope" })).toBe(false);
    expect(accepts("import:run", "response", { ok: true, report: { ...report, extra: 1 } })).toBe(
      false,
    );
    const badSkip = { ...report, skipped: [{ name: "creators", rows: 1, why: "lost" }] };
    expect(accepts("import:run", "response", { ok: true, report: badSkip })).toBe(false);
    const badTable = { ...report, tables: [{ name: "", inOld: 1, toAdd: 1, already: 0 }] };
    expect(accepts("import:run", "response", { ok: true, report: badTable })).toBe(false);
    const negative = { ...report, unsent: { outbox: -1, activity: 0 } };
    expect(accepts("import:run", "response", { ok: true, report: negative })).toBe(false);
  });

  it("lists candidates with an ISO time, and the picker answers a path or null", () => {
    const candidate = {
      path: "C:/old/gratovo.db",
      modifiedAt: "2026-10-20T08:00:00.000Z",
      size: 1,
    };
    expect(accepts("import:candidates", "response", { candidates: [candidate] })).toBe(true);
    expect(
      accepts("import:candidates", "response", {
        candidates: [{ ...candidate, modifiedAt: "yesterday" }],
      }),
    ).toBe(false);
    expect(
      accepts("import:candidates", "response", { candidates: Array(21).fill(candidate) }),
    ).toBe(false);
    expect(accepts("import:pick", "response", { path: null })).toBe(true);
    expect(accepts("import:pick", "response", {})).toBe(false);
  });
});

describe("writing:rules", () => {
  const rule = {
    id: "BRD-QUAL-01",
    area: "brand",
    stage: "qualify",
    title: "Reach the person who owns the budget",
    rule: "Start at the CEO at small brands.",
    level: "must",
  };

  it("answers the rules and whether the files were found", () => {
    expect(accepts("writing:rules", "response", { found: true, rules: [rule] })).toBe(true);
    expect(accepts("writing:rules", "response", { found: false, rules: [] })).toBe(true);
  });

  it("refuses an unknown level, a bad id or extra fields", () => {
    const answer = (r: unknown) => ({ found: true, rules: [r] });
    expect(accepts("writing:rules", "response", answer({ ...rule, level: "maybe" }))).toBe(false);
    expect(accepts("writing:rules", "response", answer({ ...rule, id: "brd qual" }))).toBe(false);
    expect(accepts("writing:rules", "response", answer({ ...rule, src: [] }))).toBe(false);
  });
});

describe("connections:status", () => {
  it("accepts the full snapshot", () => {
    expect(accepts("connections:status", "response", status)).toBe(true);
  });

  it("refuses any secret value, at any depth", () => {
    const leaks = [
      { ...status, mailApp: { set: true, secret: "gocspx-000" } },
      { ...status, mailApp: { set: true, id: "1234.apps.googleusercontent.com" } },
      { ...status, aws: { ...status.aws, accessKeyId: "AKIAEXAMPLE000000000" } },
      { ...status, aws: { ...status.aws, secretAccessKey: "s3cr3t" } },
      { ...status, proxies: { ...status.proxies, urls: ["http://user:pw@proxy:8080"] } },
      { ...status, mailboxes: [{ ...status.mailboxes[0], refreshToken: "1//token" }] },
      { ...status, youtube: { state: "available", key: "AIza-000" } },
      { ...status, gateways: [{ url: "https://abc.execute-api.us-east-1.amazonaws.com" }] },
    ];
    for (const leak of leaks) {
      expect(accepts("connections:status", "response", leak)).toBe(false);
    }
  });

  it("checks the states, the caps and the mailbox limit", () => {
    expect(
      accepts("connections:status", "response", { ...status, python: { state: "maybe" } }),
    ).toBe(false);
    const box = status.mailboxes[0];
    const withBox = (b: unknown) => ({ ...status, mailboxes: [b] });
    expect(accepts("connections:status", "response", withBox({ ...box, dailyCap: 9 }))).toBe(false);
    expect(accepts("connections:status", "response", withBox({ ...box, dailyCap: 51 }))).toBe(
      false,
    );
    expect(accepts("connections:status", "response", withBox({ ...box, health: "great" }))).toBe(
      false,
    );
    expect(
      accepts("connections:status", "response", { ...status, mailboxes: Array(21).fill(box) }),
    ).toBe(false);
    expect(accepts("connections:status", "response", { ...status, sync: { state: "lost" } })).toBe(
      false,
    );
    expect(
      accepts("connections:status", "response", {
        ...status,
        gemini: { ...gemini, state: "flying" },
      }),
    ).toBe(false);
  });
});

describe("connections:set", () => {
  const valid = [
    { kind: "mail.client", id: "1234.apps.googleusercontent.com", secret: "gocspx-000" },
    { kind: "mail.settings", label: "Gratovo", senderName: null },
    { kind: "mail.settings", label: "Gratovo", senderName: "Sam at Gratovo" },
    { kind: "mailbox.update", address: "sam@example.com", dailyCap: 10, warmupStartedOn: null },
    {
      kind: "mailbox.update",
      address: "sam@example.com",
      dailyCap: 50,
      warmupStartedOn: "2026-10-24",
    },
    { kind: "mailbox.remove", address: "sam@example.com" },
    { kind: "proxies.urls", urls: ["http://user:pw@proxy.example.com:8080"] },
    { kind: "proxies.urls", urls: [] },
    {
      kind: "pipeline.settings",
      pacing: "fast",
      parallel: { enabled: true, maxWorkers: 16 },
      proxies: { enabled: true, includeDirect: false },
    },
    { kind: "aws.keys", accessKeyId: "AKIAEXAMPLE000000000", secretAccessKey: "s3cr3t" },
    { kind: "gateways.enabled", enabled: false },
    { kind: "course", courseDir: "D:/course", videoDir: null },
    { kind: "course", courseDir: null, videoDir: null },
  ];

  it("accepts each kind", () => {
    for (const change of valid) {
      expect(parseRequest("connections:set", change).ok).toBe(true);
    }
  });

  it("refuses an unknown kind, a missing kind and extra fields", () => {
    expect(parseRequest("connections:set", { kind: "youtube.key", key: "AIza-000" }).ok).toBe(
      false,
    );
    expect(parseRequest("connections:set", { enabled: true }).ok).toBe(false);
    expect(
      parseRequest("connections:set", { kind: "gateways.enabled", enabled: true, x: 1 }).ok,
    ).toBe(false);
  });

  it("checks the bounds", () => {
    const refused = [
      { kind: "mail.client", id: "", secret: "x" },
      { kind: "mail.client", id: "x", secret: "s".repeat(301) },
      { kind: "mail.settings", label: "", senderName: null },
      { kind: "mail.settings", label: "x".repeat(101), senderName: null },
      { kind: "mail.settings", label: "Gratovo", senderName: "Sam\r\nBcc: x@example.com" },
      { kind: "mail.settings", label: "Gratovo", senderName: "x".repeat(101) },
      { kind: "mailbox.update", address: "sam@example.com", dailyCap: 9, warmupStartedOn: null },
      { kind: "mailbox.update", address: "sam@example.com", dailyCap: 51, warmupStartedOn: null },
      { kind: "mailbox.update", address: "not an address", dailyCap: 20, warmupStartedOn: null },
      {
        kind: "mailbox.update",
        address: "sam@example.com",
        dailyCap: 20,
        warmupStartedOn: "today",
      },
      { kind: "mailbox.remove", address: "sam" },
      { kind: "proxies.urls", urls: ["has space"] },
      { kind: "proxies.urls", urls: Array(101).fill("http://proxy:1") },
      {
        kind: "pipeline.settings",
        pacing: "slow",
        parallel: { enabled: true, maxWorkers: 4 },
        proxies: { enabled: true, includeDirect: true },
      },
      {
        kind: "pipeline.settings",
        pacing: "normal",
        parallel: { enabled: true, maxWorkers: 17 },
        proxies: { enabled: true, includeDirect: true },
      },
      { kind: "aws.keys", accessKeyId: "akia-lower", secretAccessKey: "s3cr3t" },
      { kind: "aws.keys", accessKeyId: "AKIAEXAMPLE000000000", secretAccessKey: "" },
      { kind: "course", courseDir: "", videoDir: null },
    ];
    for (const change of refused) {
      expect(parseRequest("connections:set", change).ok).toBe(false);
    }
  });

  it("answers ok or a reason, never a value", () => {
    expect(accepts("connections:set", "response", { ok: true })).toBe(true);
    expect(accepts("connections:set", "response", { ok: false, reason: "unknown_mailbox" })).toBe(
      true,
    );
    expect(accepts("connections:set", "response", { ok: true, secret: "gocspx-000" })).toBe(false);
  });
});

describe("the other connections channels", () => {
  it("picks a folder for the course or its videos only", () => {
    expect(parseRequest("connections:pick-folder", { purpose: "course" }).ok).toBe(true);
    expect(parseRequest("connections:pick-folder", { purpose: "videos" }).ok).toBe(true);
    expect(parseRequest("connections:pick-folder", { purpose: "system" }).ok).toBe(false);
  });

  it("mail:connect answers an address or a reason, never a token", () => {
    expect(accepts("mail:connect", "response", { ok: true, address: "sam@example.com" })).toBe(
      true,
    );
    expect(accepts("mail:connect", "response", { ok: false, reason: "timeout" })).toBe(true);
    expect(
      accepts("mail:connect", "response", {
        ok: true,
        address: "sam@example.com",
        refreshToken: "1//token",
      }),
    ).toBe(false);
    expect(parseRequest("mail:connect", { address: "sam@example.com" }).ok).toBe(false);
  });

  it.each(["bad_state", "bad_response", "exchange_failed", "no_refresh_token"])(
    "mail:connect may fail with %s",
    (reason) => {
      expect(accepts("mail:connect", "response", { ok: false, reason })).toBe(true);
    },
  );

  it("mail:check answers each mailbox's health", () => {
    expect(accepts("mail:check", "response", { ok: true, mailboxes: status.mailboxes })).toBe(true);
    expect(accepts("mail:check", "response", { ok: false, reason: "no_client" })).toBe(true);
  });

  it("gateways take known regions, unique, at most 20", () => {
    expect(parseRequest("gateways:deploy", { regions: ["us-east-1", "eu-west-2"] }).ok).toBe(true);
    expect(parseRequest("gateways:deploy", { regions: [] }).ok).toBe(false);
    expect(parseRequest("gateways:deploy", { regions: ["us-east-1", "us-east-1"] }).ok).toBe(false);
    expect(parseRequest("gateways:deploy", { regions: ["Mars"] }).ok).toBe(false);
    expect(parseRequest("gateways:remove", { region: "us-east-1" }).ok).toBe(true);
    expect(parseRequest("gateways:remove", { region: "../x" }).ok).toBe(false);
    expect(
      accepts("gateways:deploy", "response", { ok: true, deployed: ["us-east-1"], failed: [] }),
    ).toBe(true);
    expect(accepts("gateways:remove", "response", { ok: true, removed: 1 })).toBe(true);
    expect(accepts("gateways:remove", "response", { ok: false, reason: "no_keys" })).toBe(true);
  });

  it("the Gemini channels answer its status", () => {
    for (const channel of ["gemini:start", "gemini:stop", "gemini:open-window"] as const) {
      expect(accepts(channel, "response", gemini)).toBe(true);
      expect(accepts(channel, "response", { ...gemini, token: "abc" })).toBe(false);
    }
    expect(parseRequest("gemini:start", {}).ok).toBe(true);
    expect(parseRequest("gemini:open-window", { browser: "firefox" }).ok).toBe(true);
    expect(parseRequest("gemini:open-window", { browser: null }).ok).toBe(true);
    expect(parseRequest("gemini:open-window", { browser: "C:/firefox.exe" }).ok).toBe(false);
    expect(parseRequest("gemini:open-window", {}).ok).toBe(false);
  });
});
