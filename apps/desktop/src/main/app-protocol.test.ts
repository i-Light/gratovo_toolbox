import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ protocol: {} }));

import { answerAppRequest } from "./app-protocol";
import type { ImageService } from "./find/images";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gratovo-protocol-"));
  await writeFile(join(root, "index.html"), "<!doctype html>");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function fakeImages(): ImageService & { get: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn((key: string) =>
      Promise.resolve(
        key === "v:dQw4w9WgXcQ"
          ? ({ status: 200, type: "image/jpeg", body: jpeg } as const)
          : ({ status: 404 } as const),
      ),
    ),
  };
}

describe("answerAppRequest", () => {
  it("serves a picture with its type and a day's cache", async () => {
    const images = fakeImages();
    const response = await answerAppRequest(new Request("app://gratovo/img/v:dQw4w9WgXcQ"), root, {
      images,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("max-age=86400");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg);
  });

  it("decodes the key once", async () => {
    const images = fakeImages();
    await answerAppRequest(new Request("app://gratovo/img/v%3AdQw4w9WgXcQ"), root, { images });
    await answerAppRequest(new Request("app://gratovo/img/v%253AdQw4w9WgXcQ"), root, { images });
    expect(images.get.mock.calls).toEqual([["v:dQw4w9WgXcQ"], ["v%3AdQw4w9WgXcQ"]]);
  });

  it.each([
    ["an unknown picture", "GET", "app://gratovo/img/v:aaaaaaaaaaa"],
    ["a bad escape", "GET", "app://gratovo/img/%E0%A4%A"],
    ["a POST", "POST", "app://gratovo/img/v:dQw4w9WgXcQ"],
  ])("answers 404 for %s", async (_name, method, url) => {
    const response = await answerAppRequest(new Request(url, { method }), root, {
      images: fakeImages(),
    });
    expect(response.status).toBe(404);
  });

  it("answers 404 when the image service fails", async () => {
    const images: ImageService = { get: () => Promise.reject(new Error("broken")) };
    const response = await answerAppRequest(new Request("app://gratovo/img/v:dQw4w9WgXcQ"), root, {
      images,
    });
    expect(response.status).toBe(404);
  });

  it("still serves the app's files, with or without pictures", async () => {
    for (const deps of [{}, { images: fakeImages() }]) {
      const response = await answerAppRequest(new Request("app://gratovo/index.html"), root, deps);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    }
  });

  it("treats a picture address as a missing file when there is no image service", async () => {
    const response = await answerAppRequest(new Request("app://gratovo/img/v:dQw4w9WgXcQ"), root);
    expect(response.status).toBe(404);
  });
});
