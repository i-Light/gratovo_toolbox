import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Network } from "../net/network";

import { createImageNetwork, createImageService, type ImageServiceDeps } from "./images";

/** The cache's file name part for an id (images.ts names files by the id in hex). */
function hexOf(id: string): string {
  return Buffer.from(id, "utf8").toString("hex");
}

const videoId = "dQw4w9WgXcQ";
const channelId = "UCabcdefghijklmnopqrstuv";
const picture = "https://yt3.ggpht.com/ytc/AIdro_abc=s88-c-k-c0x00ffffff-no-rj";
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function imageResponse(body: Uint8Array = jpeg, type = "image/jpeg"): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": type } });
}

let dir: string;
let cacheDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "gratovo-images-"));
  cacheDir = join(dir, "image-cache");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** The real allowlist over a fake fetch, with the request calls recorded. */
function setup(options: {
  fetch?: typeof fetch;
  enabled?: boolean;
  channelPicture?: string | null;
  now?: () => number;
}) {
  const fake = vi.fn<typeof fetch>(options.fetch ?? (() => Promise.resolve(imageResponse())));
  const real = createImageNetwork(fake);
  const request = vi.fn<Network["request"]>((url, init) => real.request(url, init));
  const deps: ImageServiceDeps = {
    network: { request },
    cacheDir,
    enabled: () => options.enabled ?? true,
    channelPicture: () => (options.channelPicture === undefined ? picture : options.channelPicture),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  return { fake, request, images: createImageService(deps) };
}

describe("picture keys", () => {
  it.each([
    "",
    "v:short",
    "v:dQw4w9WgXcQx",
    "v:../../x",
    "v:..\\..\\abcde",
    "v:dQw4w9WgX/Q",
    "c:abcdefghijklmnopqrstuvwx",
    "c:UCabc",
    "x:dQw4w9WgXcQ",
    " v:dQw4w9WgXcQ",
    "v:dQw4w9WgXcQ\n",
  ])("refuses %j without touching the network", async (key) => {
    const { fake, images } = setup({});
    expect(await images.get(key)).toEqual({ status: 404 });
    expect(fake).not.toHaveBeenCalled();
  });

  it("builds the thumbnail address from the video id", async () => {
    const { fake, request, images } = setup({});
    const reply = await images.get(`v:${videoId}`);
    expect(reply).toEqual({ status: 200, type: "image/jpeg", body: jpeg });
    expect(fake.mock.calls[0]?.[0]).toBe(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
    const init = fake.mock.calls[0]?.[1];
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(request.mock.calls[0]?.[1]?.timeoutMs).toBe(10_000);
  });

  it("fetches a channel's stored picture on YouTube's image hosts", async () => {
    const { fake, images } = setup({});
    expect((await images.get(`c:${channelId}`)).status).toBe(200);
    expect(fake.mock.calls[0]?.[0]).toBe(picture);

    const other = setup({ channelPicture: "https://yt3.googleusercontent.com/abc=s88" });
    expect((await other.images.get(`c:${channelId}`)).status).toBe(200);
  });

  it.each([
    ["no stored picture", null],
    ["another host", "https://evil.example/abc.jpg"],
    ["a look-alike host", "https://yt3.ggpht.com.evil.example/abc.jpg"],
    ["plain http", "http://yt3.ggpht.com/abc.jpg"],
    ["a login", "https://user:pass@yt3.ggpht.com/abc.jpg"],
    ["a user name", "https://user@yt3.ggpht.com/abc.jpg"],
    ["a port", "https://yt3.ggpht.com:8443/abc.jpg"],
    ["the thumbnail host", "https://i.ytimg.com/vi/abc/mqdefault.jpg"],
    ["not an address", "yt3.ggpht.com/abc.jpg"],
  ])("refuses a channel picture with %s", async (_name, stored) => {
    const { fake, images } = setup({ channelPicture: stored });
    expect(await images.get(`c:${channelId}`)).toEqual({ status: 404 });
    expect(fake).not.toHaveBeenCalled();
  });
});

describe("the cache", () => {
  it("writes a fetched picture and serves the next request from disk", async () => {
    const { fake, images } = setup({});
    await images.get(`v:${videoId}`);
    expect(await readdir(cacheDir)).toEqual([`v_${hexOf(videoId)}.jpg`]);

    const again = await images.get(`v:${videoId}`);
    expect(again.status).toBe(200);
    expect(again.status === 200 && [...again.body]).toEqual([...jpeg]);
    expect(fake).toHaveBeenCalledOnce();
  });

  it("names the file by the content type and touches it on a hit", async () => {
    let time = Date.UTC(2026, 9, 1);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { images } = setup({
      fetch: () => Promise.resolve(imageResponse(png, "image/png; charset=binary")),
      now: () => time,
    });
    await images.get(`c:${channelId}`);
    const file = join(cacheDir, `c_${hexOf(channelId)}.png`);
    expect((await stat(file)).mtimeMs).toBe(time);

    time += 60_000;
    expect(await images.get(`c:${channelId}`)).toMatchObject({ status: 200, type: "image/png" });
    expect((await stat(file)).mtimeMs).toBe(time);
  });

  it("never fetches when disabled, but still serves what is on disk", async () => {
    const { fake, images } = setup({ enabled: false });
    expect(await images.get(`v:${videoId}`)).toEqual({ status: 404 });
    expect(fake).not.toHaveBeenCalled();

    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `v_${hexOf(videoId)}.webp`), jpeg);
    expect(await images.get(`v:${videoId}`)).toMatchObject({ status: 200, type: "image/webp" });
    expect(fake).not.toHaveBeenCalled();
  });
});

describe("failed fetches", () => {
  it.each([
    [
      "a page instead of a picture",
      () => new Response("<html>", { headers: { "Content-Type": "text/html" } }),
    ],
    ["an svg", () => imageResponse(jpeg, "image/svg+xml")],
    ["no content type", () => new Response(jpeg, { headers: { "Content-Type": "" } })],
    ["a 404", () => new Response(jpeg, { status: 404, headers: { "Content-Type": "image/jpeg" } })],
    [
      "a redirect answer",
      () => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } }),
    ],
    ["an empty body", () => imageResponse(new Uint8Array())],
    ["a body past 2 MB", () => imageResponse(new Uint8Array(2 * 1024 * 1024 + 1))],
    [
      "a declared length past 2 MB",
      () =>
        new Response(jpeg, {
          headers: { "Content-Type": "image/jpeg", "Content-Length": String(3 * 1024 * 1024) },
        }),
    ],
  ])("answers 404 for %s and writes nothing", async (_name, answer) => {
    const { images } = setup({ fetch: () => Promise.resolve(answer()) });
    expect(await images.get(`v:${videoId}`)).toEqual({ status: 404 });
    await expect(readdir(cacheDir)).rejects.toThrow();
  });

  it("stops reading a streamed body once it passes 2 MB", async () => {
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(512 * 1024));
      },
    });
    const { images } = setup({
      fetch: () =>
        Promise.resolve(new Response(endless, { headers: { "Content-Type": "image/jpeg" } })),
    });
    expect(await images.get(`v:${videoId}`)).toEqual({ status: 404 });
    expect(pulls).toBeLessThan(8);
  });

  it.each([
    ["a refused redirect", new TypeError("fetch failed: redirect mode is set to error")],
    ["a timeout", new DOMException("The operation timed out.", "TimeoutError")],
    ["a network failure", new TypeError("fetch failed")],
  ])("answers 404 for %s", async (_name, error) => {
    const { images } = setup({ fetch: () => Promise.reject(error) });
    expect(await images.get(`v:${videoId}`)).toEqual({ status: 404 });
  });

  it("logs the kind of failure, never the address or the key", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { images } = setup({ fetch: () => Promise.reject(new TypeError("fetch failed")) });
    await images.get(`c:${channelId}`);
    const lines = log.mock.calls.flat().join("\n");
    expect(lines).toContain("network");
    expect(lines).not.toContain("ggpht");
    expect(lines).not.toContain(channelId);
  });

  it("doesn't refetch a failed picture for 10 minutes", async () => {
    let time = 1_000_000;
    const { fake, images } = setup({
      fetch: () => Promise.resolve(new Response(null, { status: 500 })),
      now: () => time,
    });
    await images.get(`v:${videoId}`);
    time += 9 * 60_000;
    expect(await images.get(`v:${videoId}`)).toEqual({ status: 404 });
    expect(fake).toHaveBeenCalledOnce();

    time += 61_000;
    await images.get(`v:${videoId}`);
    expect(fake).toHaveBeenCalledTimes(2);
  });
});

describe("fetching at once", () => {
  /** A fetch whose answers the test hands out one by one. */
  function held() {
    const answers: ((response: Response) => void)[] = [];
    const fetchImpl = () =>
      new Promise<Response>((resolve) => {
        answers.push(resolve);
      });
    return { answers, fetchImpl };
  }

  it("fetches a key asked for twice at once only once", async () => {
    const { answers, fetchImpl } = held();
    const { fake, images } = setup({ fetch: fetchImpl });
    const first = images.get(`v:${videoId}`);
    const second = images.get(`v:${videoId}`);
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    answers[0]?.(imageResponse());
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(fake).toHaveBeenCalledOnce();
  });

  it("runs at most 6 fetches and queues the rest", async () => {
    const { answers, fetchImpl } = held();
    const { fake, images } = setup({ fetch: fetchImpl });
    const ids = Array.from({ length: 8 }, (_, i) => `video${String(i).padStart(6, "0")}`);
    const replies = ids.map((id) => images.get(`v:${id}`));
    await vi.waitFor(() => {
      expect(answers).toHaveLength(6);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake).toHaveBeenCalledTimes(6);

    answers[0]?.(imageResponse());
    await vi.waitFor(() => {
      expect(answers).toHaveLength(7);
    });
    for (let i = 1; i < 8; i += 1) {
      await vi.waitFor(() => {
        expect(answers.length).toBeGreaterThan(i);
      });
      answers[i]?.(imageResponse());
    }
    expect((await Promise.all(replies)).every((reply) => reply.status === 200)).toBe(true);
    expect(fake).toHaveBeenCalledTimes(8);
  });
});

describe("pruning", () => {
  it("deletes the oldest files down to 3,500 once the folder passes 4,000", async () => {
    await mkdir(cacheDir, { recursive: true });
    const names = Array.from({ length: 4_000 }, (_, i) => `v_${String(i).padStart(22, "0")}.jpg`);
    for (let start = 0; start < names.length; start += 200) {
      await Promise.all(
        names.slice(start, start + 200).map(async (name, offset) => {
          const file = join(cacheDir, name);
          await writeFile(file, jpeg);
          // Oldest first: file 0 is the oldest.
          const seconds = 1_700_000_000 + start + offset;
          await utimes(file, seconds, seconds);
        }),
      );
    }
    const stranger = join(cacheDir, "notes.txt");
    await writeFile(stranger, "not ours");
    await utimes(stranger, 1, 1);

    const { images } = setup({});
    expect((await images.get(`v:${videoId}`)).status).toBe(200);

    const left = await readdir(cacheDir);
    expect(left).toContain(`v_${hexOf(videoId)}.jpg`);
    expect(left).toContain("notes.txt");
    expect(left.filter((name) => name !== "notes.txt")).toHaveLength(3_500);
    expect(left).not.toContain(names[0]);
    expect(left).not.toContain(names[500]);
    expect(left).toContain(names[501]);
    expect(left).toContain(names[3_999]);
  }, 60_000);
});
