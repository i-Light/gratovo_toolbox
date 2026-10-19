import type { ElectronApplication } from "@playwright/test";

import { expect, test } from "./fixtures";

const appPage = "app://gratovo/index.html";

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
    expect(page.url()).toBe(appPage);
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
      const paths = [
        "/index.html",
        "/missing.js",
        "/%2F..%2F..%2Fmain%2Findex.js",
        "/..%5C..%5Cmain%5Cindex.js",
        "/..%5C..%5C..%5Cpackage.json",
      ];
      const gets = paths.map(async (path) => (await fetch(path)).status);
      const post = fetch("/index.html", { method: "POST" }).then((response) => response.status);
      return Promise.all([...gets, post]);
    });
    expect(statuses).toEqual([200, 404, 404, 404, 404, 404]);
  });
});

test.describe("the bridge", () => {
  test("is one function on window.gratovo, and nothing else", async ({ page }) => {
    const shape = await page.evaluate(() => ({
      keys: Object.keys(window.gratovo),
      invoke: typeof window.gratovo.invoke,
    }));
    expect(shape).toEqual({ keys: ["invoke"], invoke: "function" });
  });

  test("answers the channels on the allowlist", async ({ app, page }) => {
    const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion());
    const ping = await page.evaluate(() => window.gratovo.invoke("app:ping", {}));
    expect(ping).toEqual({ ok: true, value: { ok: true, version } });

    const status = await page.evaluate(() =>
      window.gratovo.invoke("secrets:status", { name: "gemini.api-key" }),
    );
    expect(status.ok && typeof status.value.set).toBe("boolean");
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
        [{ toString: () => "app:ping" }, {}],
        ["app:ping", { extra: true }],
        ["app:ping", "ping"],
        ["secrets:status", { name: "../keys" }],
        ["secrets:status", { name: "gemini.api-key", value: "sk-test-000" }],
      ];
      return Promise.all(calls.map(([channel, input]) => invoke(channel, input)));
    });
    expect(results).toHaveLength(13);
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, reason: expect.any(String) });
    }
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
    expect(page.url()).toBe(appPage);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
