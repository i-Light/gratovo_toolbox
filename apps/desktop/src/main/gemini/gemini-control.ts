import { join, resolve } from "node:path";

import { browserId, type GeminiStatus } from "@gratovo/ipc";

import { daemonEventDataSchema, type GeminiEvent } from "../pipeline/gemini-protocol";
import type { GeminiService, GeminiStartOptions } from "../pipeline/gemini-service";
import type { GeminiControl } from "../services";

/**
 * Settings › Connections' Gemini row (plan step 4, D12): the owner starts the bridge, stops it, or
 * opens the Gemini window. Nothing here ever sends a prompt.
 *
 * The status is one `GeminiStatus` built from three sources: the service's own state, the
 * bridge's `daemon` events (the add-on connecting and leaving, the browser starting, a failure),
 * and the answers to `bridge.status`, `bridge.browser_info` and `bridge.ensure_window`. Each
 * change is pushed through `emit` (the `gemini:state` event).
 *
 * A switch of data source stops the bridge (ADR 0014's open item): it reads the `pipeline.db` of
 * the source it was started with, so it must not outlive that source. `sourceChanged()` does it;
 * the owner starts it again from Connections.
 */

type Problem = NonNullable<GeminiStatus["problem"]>;

/** What a start needs. `extensionDir` null: the add-on isn't on this computer (packaged build). */
export type GeminiLaunchOptions = Omit<GeminiStartOptions, "extensionDir"> & {
  extensionDir: string | null;
};

export interface GeminiControlDeps {
  service: GeminiService;
  /** Built from the open source; null when no data is open (no pipeline folder to give it). */
  startOptions(): GeminiLaunchOptions | null;
  /** The pipeline's interpreter, or null when there is none (packaged until step 3h). */
  pythonPath(): unknown;
  /** Pushes a changed status to the page (`gemini:state`). */
  emit(status: GeminiStatus): void;
}

export interface GeminiControlHandle extends GeminiControl {
  status(): Promise<GeminiStatus>;
  /** Stops the bridge when the data source switches (it would read the other source's data). */
  sourceChanged(): Promise<GeminiStatus>;
  /** Drops the service subscriptions (app quit; tests). */
  dispose(): void;
}

/**
 * The add-on's source folder, `<repo>/services/gemini-extension`, found the way `findPython` finds
 * the pipeline (`appPath` is `apps/desktop`). Null in a packaged build (until step T5) and when the
 * folder has no `manifest.json` (it held only a README before the add-on was ported).
 */
export function findExtensionDir(o: {
  packaged: boolean;
  appPath: string;
  exists: (path: string) => boolean;
}): string | null {
  if (o.packaged) {
    return null;
  }
  const dir = resolve(o.appPath, "..", "..", "services", "gemini-extension");
  return o.exists(join(dir, "manifest.json")) ? dir : null;
}

/**
 * The options a start uses (D12): the open source's pipeline folder, the managed browser profile
 * in the app's folder, the add-on's folder, and the course folders when this computer has them.
 */
export function geminiLaunchOptions(o: {
  dataDir: string;
  userData: string;
  extensionDir: string | null;
  course?: { courseDir?: string | null; videoDir?: string | null } | null;
}): GeminiLaunchOptions {
  const options: GeminiLaunchOptions = {
    dataDir: o.dataDir,
    profileDir: join(o.userData, "gemini-profile"),
    extensionDir: o.extensionDir,
  };
  const courseDir = o.course?.courseDir;
  const videoDir = o.course?.videoDir;
  if (typeof courseDir === "string" && courseDir !== "") {
    options.courseDir = courseDir;
  }
  if (typeof videoDir === "string" && videoDir !== "") {
    options.videoDir = videoDir;
  }
  return options;
}

const versionMax = 50;

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/** A browser id as the ipc schema takes it, or null. */
function browserOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const id = value.trim().toLowerCase();
  return browserId.safeParse(id).success ? id : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createGeminiControl(deps: GeminiControlDeps): GeminiControlHandle {
  const { service } = deps;
  let problem: Problem | null = null;
  let addonConnected = false;
  let addonVersion: string | null = null;
  let noExtension = false;
  let browser: string | null = null;
  let stopping = false;
  let starting: Promise<GeminiStatus> | null = null;
  let last = "";

  function snapshot(): GeminiStatus {
    const running = service.state;
    const state =
      running === "listening" || running === "starting"
        ? running
        : problem === null
          ? "stopped"
          : "failed";
    const connected = state === "listening" && addonConnected;
    return {
      state,
      addon: {
        state: noExtension ? "missing" : connected ? "connected" : "disconnected",
        version: addonVersion,
      },
      browser,
      problem: state === "listening" || state === "starting" ? null : problem,
    };
  }

  /** Pushes the status when it changed, and returns it. */
  function changed(): GeminiStatus {
    const status = snapshot();
    const key = JSON.stringify(status);
    if (key !== last) {
      last = key;
      deps.emit(status);
    }
    return status;
  }

  function fromHello(hello: unknown): void {
    const data = record(hello);
    if (data === null) {
      return;
    }
    addonVersion = text(data.extensionVersion, versionMax) ?? addonVersion;
    browser = browserOf(data.browser) ?? browser;
  }

  function onEvent(event: GeminiEvent): void {
    if (event.event === "hello") {
      addonConnected = true;
      fromHello(event.data);
      changed();
      return;
    }
    if (event.event !== "daemon") {
      return;
    }
    const parsed = daemonEventDataSchema.safeParse(event.data);
    if (!parsed.success) {
      return;
    }
    const data = parsed.data;
    switch (data.state) {
      case "extension_connected":
        addonConnected = true;
        fromHello(data.hello);
        break;
      case "extension_disconnected":
        addonConnected = false;
        break;
      case "browser_launching":
      case "browser_ready":
      case "addon_installing":
        browser = browserOf(data.browser) ?? browser;
        break;
      case "failed":
        problem = data.reason === "port_in_use" ? "port_in_use" : "crash";
        break;
      case "listening":
        problem = null;
        break;
      case "stopped":
        addonConnected = false;
        break;
    }
    changed();
  }

  function onExit(): void {
    addonConnected = false;
    if (!stopping && problem === null) {
      // Gone without being asked: it crashed (a failed start already set its own problem).
      problem = "crash";
    }
    changed();
  }

  const unsubscribe = [service.onEvent(onEvent), service.onExit(onExit)];

  /** `bridge.status`: whether the add-on is connected now, and its hello. */
  async function refresh(): Promise<void> {
    if (service.state !== "listening") {
      return;
    }
    const answer = await service.call("bridge.status", {});
    if (answer.ok) {
      addonConnected = answer.result.extensionConnected;
      fromHello(answer.result.hello);
    }
  }

  /** `bridge.browser_info`: which browser the bridge drives (its own choice until Settings picks). */
  async function learnBrowser(): Promise<void> {
    const answer = await service.call("bridge.browser_info", {});
    if (answer.ok) {
      browser = browserOf(answer.result.selected) ?? browser;
      if (answer.result.addon.state !== "missing") {
        addonVersion = text(answer.result.addon.shippedVersion, versionMax) ?? addonVersion;
      }
    }
  }

  async function startOnce(): Promise<GeminiStatus> {
    if (service.state !== "stopped") {
      await refresh();
      return changed();
    }
    const options = deps.startOptions();
    noExtension = false;
    if (options === null) {
      problem = "no_data";
      return changed();
    }
    if (options.extensionDir === null) {
      problem = "no_extension";
      noExtension = true;
      return changed();
    }
    if (deps.pythonPath() === null) {
      problem = "no_python";
      return changed();
    }
    problem = null;
    stopping = false;
    addonConnected = false;
    const begun = service.start({ ...options, extensionDir: options.extensionDir });
    changed();
    const outcome = await begun;
    if (!outcome.ok) {
      problem = outcome.problem === "running" ? null : outcome.problem;
      return changed();
    }
    problem = null;
    await learnBrowser();
    return changed();
  }

  function start(): Promise<GeminiStatus> {
    starting ??= startOnce().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function stop(): Promise<GeminiStatus> {
    if (starting !== null) {
      await starting;
    }
    stopping = true;
    try {
      await service.shutdown();
    } finally {
      stopping = false;
    }
    problem = null;
    addonConnected = false;
    return changed();
  }

  return {
    async status() {
      await refresh();
      return changed();
    },
    start,
    stop,
    async openWindow(wanted) {
      const started = await start();
      if (started.state !== "listening") {
        return started;
      }
      // Opens (or reuses) the window and gets the add-on in; it never sends a prompt.
      const answer = await service.call(
        "bridge.ensure_window",
        wanted === null ? { focus: true } : { browser: wanted, focus: true },
      );
      if (answer.ok) {
        addonConnected = answer.result.connected;
        browser = browserOf(answer.result.browser) ?? browser;
        addonVersion = text(answer.result.addon?.version, versionMax) ?? addonVersion;
      } else if (
        answer.error.code === "ADDON_INSTALL_FAILED" &&
        answer.error.details.reason === "no extension"
      ) {
        noExtension = true;
      }
      return changed();
    },
    async sourceChanged() {
      if (service.state === "stopped" && starting === null) {
        return snapshot();
      }
      return stop();
    },
    dispose() {
      for (const off of unsubscribe) {
        off();
      }
    },
  };
}
