import type { ElectronApplication } from "@playwright/test";

import { appPage, expect, test } from "./fixtures";

/** The page's URL without its "#/route" part. */
const withoutFragment = (url: string): string => url.split("#")[0] ?? url;

/** Replaces shell.openExternal in the main process with a recorder, so no browser opens. */
async function recordExternalLinks(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { openedLinks: opened });
    shell.openExternal = (url) => {
      opened.push(url);
      return Promise.resolve();
    };
  });
  return () => app.evaluate(() => (globalThis as { openedLinks?: string[] }).openedLinks ?? []);
}

test.describe("the page", () => {
  test("loads from the app's own protocol, not from file://", ({ page }) => {
    expect(withoutFragment(page.url())).toBe(appPage);
  });

  test("can't reach Node", async ({ page }) => {
    const globals = await page.evaluate(() => {
      const scope = globalThis as Record<string, unknown>;
      return ["require", "process", "module", "Buffer", "ipcRenderer", "electron"].map(
        (name) => typeof scope[name],
      );
    });
    expect(globals.every((type) => type === "undefined")).toBe(true);
  });

  test("runs in the operating system's sandbox", async ({ app }) => {
    const renderers = await app.evaluate(({ app: electronApp }) =>
      electronApp
        .getAppMetrics()
        .filter((metric) => metric.type === "Tab")
        .map((metric) => metric.sandboxed),
    );
    expect(renderers.length).toBeGreaterThan(0);
    expect(renderers.every((sandboxed) => sandboxed === true)).toBe(true);
  });

  test("ships a strict content security policy, in the page and as a header", async ({ page }) => {
    const meta = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    const headers = await page.evaluate(async () => {
      const response = await fetch(location.href);
      return {
        policy: response.headers.get("content-security-policy"),
        sniffing: response.headers.get("x-content-type-options"),
      };
    });
    for (const policy of [meta, headers.policy]) {
      expect(policy).toContain("default-src 'none'");
      expect(policy).toContain("script-src 'self';");
      expect(policy).not.toContain("unsafe-inline");
    }
    expect(headers.sniffing).toBe("nosniff");
  });

  test("gets only the app's own files", async ({ page }) => {
    const statuses = await page.evaluate(async () => {
      // Each escape aims at a file that really exists next to the renderer folder (the built main
      // process and preload, the app's package.json), so a broken guard would answer 200.
      const paths = [
        "/index.html",
        "/missing.js",
        "/..%2Fmain%2Findex.js",
        "/..%2Fpreload%2Findex.js",
        "/..%5Cpreload%5Cindex.js",
        "/..%2F..%2Fpackage.json",
        "/NUL.js",
      ];
      const gets = paths.map(async (path) => (await fetch(path)).status);
      const post = fetch("/index.html", { method: "POST" }).then((response) => response.status);
      return Promise.all([...gets, post]);
    });
    expect(statuses).toEqual([200, 404, 404, 404, 404, 404, 404, 404]);
  });

  test("keeps its data apart from the installed app", async ({ app }) => {
    const folder = await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
    expect(folder).toContain("gratovo-e2e-");
  });

  test("refuses downloads", async ({ app }) => {
    const refused = await app.evaluate(({ BrowserWindow, session }) => {
      // This listener runs after the app's own, so it sees whether the app refused the download.
      const seen = new Promise<boolean>((resolve) => {
        session.defaultSession.once("will-download", (event) => {
          resolve(event.defaultPrevented);
        });
      });
      BrowserWindow.getAllWindows()[0]?.webContents.downloadURL("app://gratovo/index.html");
      return seen;
    });
    expect(refused).toBe(true);
  });
});

test.describe("the bridge", () => {
  test("is two functions on window.gratovo, invoke and on, and nothing else", async ({ page }) => {
    const shape = await page.evaluate(() => ({
      keys: Object.keys(window.gratovo).sort(),
      invoke: typeof window.gratovo.invoke,
      on: typeof window.gratovo.on,
    }));
    expect(shape).toEqual({ keys: ["invoke", "on"], invoke: "function", on: "function" });
  });

  test("on() ignores an event name outside the list and gives back an unsubscribe", async ({
    page,
  }) => {
    const answer = await page.evaluate(() => {
      const on = window.gratovo.on as (name: string, listener: () => void) => unknown;
      const unsubscribe = on("app:anything-else", () => undefined);
      return typeof unsubscribe;
    });
    expect(answer).toBe("function");
  });

  test("answers the channels on the allowlist", async ({ app, page }) => {
    const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
    const ping = await page.evaluate(() => window.gratovo.invoke("app:ping", {}));
    expect(ping).toEqual({ ok: true, value: { ok: true, version } });

    // The test's data folder is new, so no secret is set.
    const status = await page.evaluate(() =>
      window.gratovo.invoke("secrets:status", { name: "gemini.api-key" }),
    );
    expect(status).toEqual({ ok: true, value: { set: false } });
  });

  test("refuses every channel outside the allowlist", async ({ page }) => {
    const results = await page.evaluate(async () => {
      // The page's own code is typed; an attacker's isn't, so call it with anything.
      const invoke = window.gratovo.invoke as (
        channel: unknown,
        input: unknown,
      ) => Promise<unknown>;
      const calls: [unknown, unknown][] = [
        ["fs:read", { path: "C:/Users" }],
        ["secrets:get", { name: "gemini.api-key" }],
        ["shell:open", { url: "https://example.com/" }],
        ["__proto__", {}],
        ["constructor", {}],
        ["APP:PING", {}],
        ["", {}],
        [42, {}],
        [{ name: "app:ping" }, {}],
        [["app:ping"], {}],
        ["app:ping", { extra: true }],
        ["app:ping", "ping"],
        ["secrets:status", { name: "../keys" }],
        ["secrets:status", { name: "gemini.api-key", value: "sk-test-000" }],
      ];
      return Promise.all(calls.map(([channel, input]) => invoke(channel, input)));
    });
    expect(results).toHaveLength(14);
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, reason: expect.any(String) });
    }
  });

  test("can't carry code: a call holding a function is refused", async ({ page }) => {
    const outcome = await page.evaluate(async () => {
      const invoke = window.gratovo.invoke as (
        channel: unknown,
        input: unknown,
      ) => Promise<unknown>;
      try {
        return await invoke({ toString: () => "app:ping" }, {});
      } catch {
        // Today Electron refuses to send it at all; a refusal from the main process is as good.
        return { ok: false, reason: "not sent" };
      }
    });
    expect(outcome).toMatchObject({ ok: false });
  });
});

test.describe("leaving the app", () => {
  test("refuses new windows and opens only allowlisted links in the browser", async ({
    app,
    page,
  }) => {
    const openedLinks = await recordExternalLinks(app);
    await page.evaluate(() => {
      // Refused links first: the main process handles these in order, so once the allowed link
      // is recorded, the refused ones have been dealt with too.
      window.open("https://example.com/");
      window.open("http://www.youtube.com/@aiexplained");
      window.open("https://www.youtube.com/@aiexplained");
    });
    await expect.poll(openedLinks).toEqual(["https://www.youtube.com/@aiexplained"]);
    expect(app.windows()).toHaveLength(1);
  });

  test("keeps the page in place when a link or script tries to navigate", async ({ app, page }) => {
    const openedLinks = await recordExternalLinks(app);
    await page.evaluate(() => {
      location.href = "https://example.com/";
    });
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "https://youtu.be/abc123";
      document.body.append(link);
      link.click();
    });
    await expect.poll(openedLinks).toEqual(["https://youtu.be/abc123"]);
    expect(withoutFragment(page.url())).toBe(appPage);
    // Read through evaluate: after a refused navigation, Playwright's locators keep waiting for it
    // to finish.
    const title = await page.evaluate(() => document.title);
    expect(title).toBe("Gratovo Toolbox");
  });
});
