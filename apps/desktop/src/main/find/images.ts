import { randomBytes } from "node:crypto";
import {
  type FileHandle,
  mkdir,
  open,
  readdir,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { createNetwork, NetworkRefusedError, type Network } from "../net/network";

/**
 * Pictures for the Find screens (plan D9). The page has no network, so it asks for
 * app://gratovo/img/<key> and main answers from here. Main builds every address itself: a video's
 * thumbnail from its checked id, a channel's from its stored picture, and only on YouTube's image
 * hosts. Fetched pictures are kept as files under `cacheDir`, oldest pruned past 4,000.
 *
 * Example data never fetches: a picture not already on disk answers 404 and the page draws its
 * placeholder. Log lines name a kind of failure or a status, never an address or a key.
 */

/** The hosts the image network may reach, and nothing else. */
export const imageOrigins = [
  "https://i.ytimg.com",
  "https://yt3.ggpht.com",
  "https://yt3.googleusercontent.com",
] as const;

/** A network that can only reach YouTube's image hosts. W1 passes it to `createImageService`. */
export function createImageNetwork(fetchImpl?: typeof fetch): Network {
  return createNetwork({
    allowedOrigins: imageOrigins,
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}

export type ImageReply = { status: 200; type: string; body: Uint8Array } | { status: 404 };

export interface ImageService {
  get(key: string): Promise<ImageReply>;
}

export interface ImageServiceDeps {
  /** Made with `createImageNetwork`: only YouTube's image hosts. */
  network: Network;
  /** `<userData>/image-cache`. Created on the first write. */
  cacheDir: string;
  /** False on example data: nothing is fetched, only pictures already on disk are served. */
  enabled: () => boolean;
  /** The channel's stored `profile_picture`, or null. Checked here before it is fetched. */
  channelPicture: (channelId: string) => string | null;
  now?: () => number;
}

// The key is the only page input. Its id becomes part of a fixed file name and a fixed address, so
// nothing else from the page reaches the disk or the network.
const keyShape = /^(?:v:[A-Za-z0-9_-]{11}|c:UC[A-Za-z0-9_-]{22})$/;
// The files this service writes, and so the only ones pruning may delete.
const cacheName = /^[vc]_[0-9a-f]{22,48}\.(?:jpg|png|webp)(?:\.[0-9a-f]{12}\.part)?$/;
const channelHosts = new Set(["yt3.ggpht.com", "yt3.googleusercontent.com"]);

const extensions = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const typesByExtension = new Map<string, string>(
  [...extensions].map(([type, extension]) => [extension, type]),
);

const fetchTimeoutMs = 10_000;
const maxBytes = 2 * 1024 * 1024;
const negativeMs = 10 * 60_000;
const maxFetches = 6;
const maxFiles = 4_000;
const pruneTo = 3_500;
// The failure memory is cleared of old entries past this size, so it can't grow without end.
const negativeSweepAt = 5_000;

type Fetched = { ok: true; type: string; body: Uint8Array } | { ok: false; kind: string };

/** A channel picture is fetched only from https on YouTube's image hosts, with no login or port. */
function channelPictureUrl(stored: string | null): string | null {
  if (stored === null || !URL.canParse(stored)) {
    return null;
  }
  const url = new URL(stored);
  const plain = url.username === "" && url.password === "" && url.port === "";
  return url.protocol === "https:" && channelHosts.has(url.hostname) && plain ? url.href : null;
}

/** The media type before any parameters, lower case. */
function mediaType(header: string | null): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Reads the body, stopping as soon as it passes the limit. */
async function readLimited(response: Response): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    // Node types a fetch body's chunks as any; they are bytes.
    const { done, value } = (await reader.read()) as
      { done: true; value?: undefined } | { done: false; value: Uint8Array };
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function fetchImage(network: Network, url: string): Promise<Fetched> {
  let response: Response;
  try {
    // The network refuses redirects (fetch then throws), so a moved picture is a failure.
    response = await network.request(url, { method: "GET", timeoutMs: fetchTimeoutMs });
  } catch (error) {
    if (error instanceof NetworkRefusedError) {
      return { ok: false, kind: "refused" };
    }
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, kind: timeout ? "timeout" : "network" };
  }
  try {
    if (response.status !== 200 || response.redirected) {
      return { ok: false, kind: `status ${String(response.status)}` };
    }
    const type = mediaType(response.headers.get("content-type"));
    if (!extensions.has(type)) {
      return { ok: false, kind: "not an image" };
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > maxBytes) {
      return { ok: false, kind: "too large" };
    }
    const body = await readLimited(response);
    if (body === null) {
      return { ok: false, kind: "too large" };
    }
    if (body.byteLength === 0) {
      return { ok: false, kind: "empty" };
    }
    return { ok: true, type, body };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, kind: timeout ? "timeout" : "network" };
  } finally {
    if (response.body !== null && !response.bodyUsed) {
      await response.body.cancel().catch(() => undefined);
    }
  }
}

export function createImageService(deps: ImageServiceDeps): ImageService {
  const now = deps.now ?? Date.now;
  const failedUntil = new Map<string, number>();
  const inFlight = new Map<string, Promise<ImageReply>>();
  let active = 0;
  const waiting: (() => void)[] = [];
  let folderReady = false;
  // Files in the folder, counted once and then kept up to date, so a write doesn't list the folder.
  let fileCount: number | null = null;
  let pruning = false;

  async function withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (active < maxFetches) {
      active += 1;
    } else {
      // The finishing fetch hands its slot straight over, so `active` stays the same.
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next === undefined) {
        active -= 1;
      } else {
        next();
      }
    }
  }

  function rememberFailure(key: string): void {
    const time = now();
    if (failedUntil.size >= negativeSweepAt) {
      for (const [old, until] of failedUntil) {
        if (until <= time) {
          failedUntil.delete(old);
        }
      }
    }
    failedUntil.set(key, time + negativeMs);
  }

  function recentlyFailed(key: string): boolean {
    const until = failedUntil.get(key);
    if (until === undefined) {
      return false;
    }
    if (until <= now()) {
      failedUntil.delete(key);
      return false;
    }
    return true;
  }

  async function readCached(base: string): Promise<ImageReply | null> {
    for (const [extension, type] of typesByExtension) {
      const file = join(deps.cacheDir, `${base}.${extension}`);
      // One open file for the check, the read and the touch, so a file swapped in between can't
      // be served.
      let handle: FileHandle | undefined;
      try {
        // Read-write: Windows refuses to set the times through a read-only handle.
        handle = await open(file, "r+");
        const info = await handle.stat();
        if (!info.isFile() || info.size === 0 || info.size > maxBytes) {
          continue;
        }
        const body = await handle.readFile();
        // Pruning goes by modification time, so a picture in use stays.
        const seconds = now() / 1000;
        await handle.utimes(seconds, seconds).catch(() => undefined);
        return { status: 200, type, body };
      } catch {
        // Not cached with this extension.
      } finally {
        await handle?.close().catch(() => undefined);
      }
    }
    return null;
  }

  async function prune(): Promise<void> {
    if (pruning) {
      return;
    }
    pruning = true;
    try {
      const entries = await readdir(deps.cacheDir, { withFileTypes: true });
      const ours = entries.filter((entry) => entry.isFile() && cacheName.test(entry.name));
      fileCount = ours.length;
      if (ours.length <= maxFiles) {
        return;
      }
      const dated = await Promise.all(
        ours.map(async (entry) => {
          try {
            return {
              name: entry.name,
              time: (await stat(join(deps.cacheDir, entry.name))).mtimeMs,
            };
          } catch {
            return null;
          }
        }),
      );
      const files = dated.filter((file) => file !== null).sort((a, b) => a.time - b.time);
      const doomed = files.slice(0, Math.max(0, files.length - pruneTo));
      let removed = 0;
      for (const file of doomed) {
        try {
          await unlink(join(deps.cacheDir, file.name));
          removed += 1;
        } catch {
          // In use or already gone: the next prune tries again.
        }
      }
      fileCount = files.length - removed;
    } catch {
      console.error("Images: the cache folder couldn't be pruned.");
    } finally {
      pruning = false;
    }
  }

  async function store(base: string, type: string, body: Uint8Array): Promise<void> {
    const file = join(deps.cacheDir, `${base}.${extensions.get(type) ?? "jpg"}`);
    // Written beside it first, so a crash never leaves half a picture to be served later.
    const part = `${file}.${randomBytes(6).toString("hex")}.part`;
    try {
      if (!folderReady) {
        await mkdir(deps.cacheDir, { recursive: true });
        folderReady = true;
      }
      await writeFile(part, body);
      await rename(part, file);
      const seconds = now() / 1000;
      await utimes(file, seconds, seconds).catch(() => undefined);
    } catch {
      await unlink(part).catch(() => undefined);
      console.error("Images: a picture couldn't be written to the cache.");
      return;
    }
    fileCount = fileCount === null ? null : fileCount + 1;
    if (fileCount === null || fileCount > maxFiles) {
      await prune();
    }
  }

  async function load(key: string): Promise<ImageReply> {
    const kind = key.slice(0, 1);
    const id = key.slice(2);
    // The id in hex: Windows file names ignore letter case and YouTube ids don't, so two ids that
    // differ only in case must not share a file.
    const base = `${kind}_${Buffer.from(id, "utf8").toString("hex")}`;
    const cached = await readCached(base);
    if (cached !== null) {
      return cached;
    }
    if (!deps.enabled()) {
      return { status: 404 };
    }
    const url =
      kind === "v"
        ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
        : channelPictureUrl(deps.channelPicture(id));
    if (url === null) {
      return { status: 404 };
    }
    const fetched = await withSlot(() => fetchImage(deps.network, url));
    if (!fetched.ok) {
      rememberFailure(key);
      console.error(`Images: a picture couldn't be fetched (${fetched.kind}).`);
      return { status: 404 };
    }
    await store(base, fetched.type, fetched.body);
    return { status: 200, type: fetched.type, body: fetched.body };
  }

  return {
    get(key) {
      if (!keyShape.test(key) || recentlyFailed(key)) {
        return Promise.resolve({ status: 404 });
      }
      const pending = inFlight.get(key);
      if (pending !== undefined) {
        return pending;
      }
      const started = load(key)
        .catch((): ImageReply => ({ status: 404 }))
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, started);
      return started;
    },
  };
}
