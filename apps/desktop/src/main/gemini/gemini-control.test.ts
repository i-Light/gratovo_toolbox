import { join, resolve } from "node:path";

import { geminiStatusSchema, type GeminiStatus } from "@gratovo/ipc";
import { describe, expect, it } from "vitest";

import type { GeminiEvent, TypedGeminiMethod } from "../pipeline/gemini-protocol";
import type {
  GeminiCall,
  GeminiService,
  GeminiStart,
  GeminiStartOptions,
  GeminiState,
} from "../pipeline/gemini-service";
import {
  createGeminiControl,
  findExtensionDir,
  geminiLaunchOptions,
  type GeminiLaunchOptions,
} from "./gemini-control";

type Answer =
  { ok: true; result: unknown } | { ok: false; error: { code: string; details: object } };

/** A bridge service that records what it is asked and answers from a script. */
class FakeService implements GeminiService {
  state: GeminiState = "stopped";
  starts: GeminiStartOptions[] = [];
  calls: { method: string; params: unknown }[] = [];
  shutdowns = 0;
  startWith: GeminiStart = { ok: true };
  answers: Partial<Record<TypedGeminiMethod, Answer>> = {
    "bridge.status": {
      ok: true,
      result: { listening: true, port: 8765, extensionConnected: false, hello: null, status: null },
    },
    "bridge.browser_info": {
      ok: true,
      result: { selected: "firefox", addon: { state: "missing", shippedVersion: "0.4.0" } },
    },
  };
  private events = new Set<(event: GeminiEvent) => void>();
  private exits = new Set<() => void>();

  start(options: GeminiStartOptions): Promise<GeminiStart> {
    this.starts.push(options);
    this.state = this.startWith.ok ? "listening" : "stopped";
    return Promise.resolve(this.startWith);
  }

  call<M extends TypedGeminiMethod>(method: M, params: unknown): Promise<GeminiCall<M>> {
    this.calls.push({ method, params });
    const answer = this.answers[method] ?? {
      ok: false,
      error: { code: "INTERNAL", message: "unscripted", details: {} },
    };
    return Promise.resolve(answer as GeminiCall<M>);
  }

  onEvent(listener: (event: GeminiEvent) => void): () => void {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }

  onExit(listener: () => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  shutdown(): Promise<void> {
    this.shutdowns += 1;
    if (this.state !== "stopped") {
      this.exit();
    }
    return Promise.resolve();
  }

  /** The bridge's process ends (asked to or not). */
  exit(): void {
    this.state = "stopped";
    for (const listener of this.exits) {
      listener();
    }
  }

  daemon(data: Record<string, unknown>): void {
    for (const listener of this.events) {
      listener({ type: "event", event: "daemon", data });
    }
  }
}

const launch: GeminiLaunchOptions = {
  dataDir: "C:\\data\\live\\pipeline",
  profileDir: "C:\\user\\gemini-profile",
  extensionDir: "C:\\repo\\services\\gemini-extension",
};

function setup(o: { options?: GeminiLaunchOptions | null; python?: boolean } = {}) {
  const service = new FakeService();
  const emitted: GeminiStatus[] = [];
  let options = o.options === undefined ? launch : o.options;
  const control = createGeminiControl({
    service,
    startOptions: () => options,
    pythonPath: () => (o.python === false ? null : { python: "py.exe", cwd: "pipeline" }),
    emit: (status) => {
      expect(geminiStatusSchema.parse(status)).toEqual(status);
      emitted.push(status);
    },
  });
  return {
    service,
    control,
    emitted,
    setOptions: (next: GeminiLaunchOptions | null) => {
      options = next;
    },
  };
}

const stopped: GeminiStatus = {
  state: "stopped",
  addon: { state: "disconnected", version: null },
  browser: null,
  problem: null,
};

describe("the Gemini control", () => {
  it("is stopped until the owner starts it", async () => {
    const { control, service } = setup();
    expect(await control.status()).toEqual(stopped);
    expect(service.starts).toEqual([]);
    expect(service.calls).toEqual([]);
  });

  it("starts the bridge with the open source's options and learns its browser", async () => {
    const { control, service, emitted } = setup();
    const status = await control.start();
    expect(service.starts).toEqual([launch]);
    expect(status).toEqual({
      state: "listening",
      addon: { state: "disconnected", version: null },
      browser: "firefox",
      problem: null,
    });
    expect(emitted.at(-1)).toEqual(status);
  });

  it("starts once when asked twice at the same time", async () => {
    const { control, service } = setup();
    await Promise.all([control.start(), control.start()]);
    expect(service.starts).toHaveLength(1);
    await control.start();
    expect(service.starts).toHaveLength(1);
  });

  it("says no_data when no source is open, no_extension without the add-on, no_python", async () => {
    const noData = setup({ options: null });
    expect(await noData.control.start()).toMatchObject({ state: "failed", problem: "no_data" });

    const noAddOn = setup({ options: { ...launch, extensionDir: null } });
    expect(await noAddOn.control.start()).toEqual({
      state: "failed",
      addon: { state: "missing", version: null },
      browser: null,
      problem: "no_extension",
    });

    const noPython = setup({ python: false });
    expect(await noPython.control.start()).toMatchObject({ state: "failed", problem: "no_python" });
    for (const each of [noData, noAddOn, noPython]) {
      expect(each.service.starts).toEqual([]);
    }
  });

  it("reports a taken port and a crashed start", async () => {
    const taken = setup();
    taken.service.startWith = { ok: false, problem: "port_in_use" };
    expect(await taken.control.start()).toMatchObject({ state: "failed", problem: "port_in_use" });

    const crashed = setup();
    crashed.service.startWith = { ok: false, problem: "crash" };
    expect(await crashed.control.start()).toMatchObject({ state: "failed", problem: "crash" });
  });

  it("follows the add-on and the browser from the daemon's events", async () => {
    const { control, service, emitted } = setup();
    await control.start();
    service.daemon({ state: "browser_launching", browser: "firefox", message: "Starting" });
    service.daemon({ state: "addon_installing", browser: "firefox", message: "Installing" });
    service.daemon({
      state: "extension_connected",
      hello: { extensionVersion: "0.4.0", browser: "Firefox", port: 8765 },
    });
    expect(emitted.at(-1)).toEqual({
      state: "listening",
      addon: { state: "connected", version: "0.4.0" },
      browser: "firefox",
      problem: null,
    });
    service.daemon({ state: "extension_disconnected", code: 1001, reason: "" });
    expect(emitted.at(-1)?.addon).toEqual({ state: "disconnected", version: "0.4.0" });
    // A line that doesn't fit the schema changes nothing.
    const before = emitted.length;
    service.daemon({ state: "made_up" });
    expect(emitted).toHaveLength(before);
  });

  it("reads the add-on's connection from bridge.status", async () => {
    const { control, service } = setup();
    await control.start();
    service.answers["bridge.status"] = {
      ok: true,
      result: {
        listening: true,
        port: 8765,
        extensionConnected: true,
        hello: { extensionVersion: "0.4.0", browser: "edge" },
        status: null,
      },
    };
    expect(await control.status()).toEqual({
      state: "listening",
      addon: { state: "connected", version: "0.4.0" },
      browser: "edge",
      problem: null,
    });
  });

  it("turns an exit nobody asked for into a crash", async () => {
    const { control, service, emitted } = setup();
    await control.start();
    service.exit();
    expect(emitted.at(-1)).toMatchObject({ state: "failed", problem: "crash" });
    expect(await control.status()).toMatchObject({ state: "failed", problem: "crash" });
  });

  it("stops by shutting the bridge down, with no problem left over", async () => {
    const { control, service } = setup();
    await control.start();
    expect(await control.stop()).toMatchObject({ state: "stopped", problem: null });
    expect(service.shutdowns).toBe(1);
  });

  it("opens the window after starting, never with a prompt", async () => {
    const { control, service } = setup();
    service.answers["bridge.ensure_window"] = {
      ok: true,
      result: {
        connected: true,
        launched: true,
        reused: false,
        browser: "edge",
        addon: { state: "unknown", version: "0.4.0", method: "unpacked" },
        tab: { tabId: 3, url: "https://gemini.google.com/app" },
        account: null,
        steps: [],
        message: "",
      },
    };
    const status = await control.openWindow("edge");
    expect(service.starts).toHaveLength(1);
    expect(service.calls.map((c) => c.method)).toEqual([
      "bridge.browser_info",
      "bridge.ensure_window",
    ]);
    expect(service.calls[1]?.params).toEqual({ browser: "edge", focus: true });
    expect(status).toEqual({
      state: "listening",
      addon: { state: "connected", version: "0.4.0" },
      browser: "edge",
      problem: null,
    });
    for (const { method } of service.calls) {
      expect(method).not.toMatch(/ask|action\./);
    }
  });

  it("leaves the browser to the bridge when none is named", async () => {
    const { control, service } = setup();
    await control.openWindow(null);
    expect(service.calls.find((c) => c.method === "bridge.ensure_window")?.params).toEqual({
      focus: true,
    });
  });

  it("does not open a window when the bridge can't start", async () => {
    const { control, service } = setup({ options: null });
    expect(await control.openWindow(null)).toMatchObject({ problem: "no_data" });
    expect(service.calls).toEqual([]);
  });

  it("marks the add-on missing when the bridge says there is no extension", async () => {
    const { control, service } = setup();
    service.answers["bridge.ensure_window"] = {
      ok: false,
      error: { code: "ADDON_INSTALL_FAILED", details: { reason: "no extension" } },
    };
    expect((await control.openWindow(null)).addon.state).toBe("missing");
  });

  it("stops the bridge when the data source switches, and starts on the new one later", async () => {
    const { control, service, setOptions } = setup();
    expect(await control.sourceChanged()).toEqual(stopped);
    expect(service.shutdowns).toBe(0);
    await control.start();
    expect(await control.sourceChanged()).toMatchObject({ state: "stopped", problem: null });
    expect(service.shutdowns).toBe(1);
    setOptions({ ...launch, dataDir: "C:\\data\\example\\pipeline" });
    await control.start();
    expect(service.starts.at(-1)?.dataDir).toBe("C:\\data\\example\\pipeline");
  });

  it("stops listening to the service once disposed", async () => {
    const { control, service, emitted } = setup();
    await control.start();
    control.dispose();
    const before = emitted.length;
    service.daemon({ state: "extension_connected", hello: { extensionVersion: "9" } });
    expect(emitted).toHaveLength(before);
  });
});

describe("where the add-on is", () => {
  const appPath = resolve("C:\\repo", "apps", "desktop");
  const dir = resolve("C:\\repo", "services", "gemini-extension");

  it("is the repository's services/gemini-extension when it has a manifest", () => {
    expect(
      findExtensionDir({
        packaged: false,
        appPath,
        exists: (path) => path === join(dir, "manifest.json"),
      }),
    ).toBe(dir);
  });

  it("is missing in a packaged build and in a folder without a manifest", () => {
    expect(findExtensionDir({ packaged: true, appPath, exists: () => true })).toBeNull();
    expect(findExtensionDir({ packaged: false, appPath, exists: () => false })).toBeNull();
  });

  it("builds the start options from the source, the app's folder and the course", () => {
    expect(
      geminiLaunchOptions({
        dataDir: "C:\\data\\pipeline",
        userData: "C:\\user",
        extensionDir: dir,
        course: { courseDir: "D:\\course", videoDir: null },
      }),
    ).toEqual({
      dataDir: "C:\\data\\pipeline",
      profileDir: join("C:\\user", "gemini-profile"),
      extensionDir: dir,
      courseDir: "D:\\course",
    });
    expect(
      geminiLaunchOptions({ dataDir: "d", userData: "u", extensionDir: null, course: null }),
    ).toEqual({ dataDir: "d", profileDir: join("u", "gemini-profile"), extensionDir: null });
  });
});
