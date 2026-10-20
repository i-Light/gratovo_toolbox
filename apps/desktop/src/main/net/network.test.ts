import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NetworkRefusedError,
  checkWebSocketUrl,
  createGuardedWebSocket,
  createNetwork,
} from "./network";

const project = "https://abcdefghijklmnopqrst.supabase.co";

function setup(allowedOrigins: string[] = [project]) {
  const fake = vi.fn<typeof fetch>(() => Promise.resolve(new Response("{}")));
  return { fake, network: createNetwork({ allowedOrigins, fetch: fake }) };
}

/** A fetch that never answers and rejects when its signal aborts. */
function hanging() {
  return vi.fn<typeof fetch>(
    (...args) =>
      new Promise<Response>((_resolve, reject) => {
        args[1]?.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      }),
  );
}

describe("createNetwork", () => {
  it("sends an allowed request with redirects refused and a timeout", async () => {
    const { fake, network } = setup();
    await network.request(`${project}/auth/v1/token?grant_type=password`, { method: "POST" });
    expect(fake).toHaveBeenCalledOnce();
    const init = fake.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("error");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["another host", "https://example.com/x"],
    ["a lookalike suffix", `${project}.evil.com/x`],
    ["a lookalike path", "https://evil.com/abcdefghijklmnopqrst.supabase.co"],
    ["a subdomain", "https://x.abcdefghijklmnopqrst.supabase.co/x"],
    ["http on the project", "http://abcdefghijklmnopqrst.supabase.co/x"],
    ["user info", "https://user:pass@abcdefghijklmnopqrst.supabase.co/x"],
    ["a user name only", "https://user@abcdefghijklmnopqrst.supabase.co/x"],
    ["a non-default port", "https://abcdefghijklmnopqrst.supabase.co:8443/x"],
    ["the local machine without the seam", "http://127.0.0.1:54321/x"],
    ["not a URL", "nope"],
    ["another scheme", "ftp://abcdefghijklmnopqrst.supabase.co/x"],
  ])("refuses %s before fetch is called", (_name, url) => {
    const { fake, network } = setup();
    expect(() => network.request(url)).toThrow(NetworkRefusedError);
    expect(fake).not.toHaveBeenCalled();
  });

  it("accepts http on 127.0.0.1 only when that origin is on the list", async () => {
    const { fake, network } = setup(["http://127.0.0.1:54321"]);
    await network.request("http://127.0.0.1:54321/rest/v1/x");
    expect(fake).toHaveBeenCalledOnce();
    expect(() => network.request("http://127.0.0.1:54322/x")).toThrow(NetworkRefusedError);
  });

  it("refuses http on a non-local host even if listed", () => {
    const { network } = setup(["http://example.com"]);
    expect(() => network.request("http://example.com/x")).toThrow(NetworkRefusedError);
  });

  it("does not put the address in the error message", () => {
    const { network } = setup();
    let message = "";
    try {
      void network.request("https://evil.example/secret-token");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("secret-token");
    expect(message).not.toContain("evil.example");
  });

  it("aborts after the timeout", async () => {
    const network = createNetwork({
      allowedOrigins: [project],
      fetch: hanging(),
    });
    await expect(network.request(`${project}/x`, { timeoutMs: 20 })).rejects.toThrow("aborted");
  });

  it("also aborts when the caller's signal does", async () => {
    const controller = new AbortController();
    const network = createNetwork({
      allowedOrigins: [project],
      fetch: hanging(),
    });
    const pending = network.request(`${project}/x`, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });
});

describe("checkWebSocketUrl", () => {
  it("accepts wss on an allowed origin", () => {
    const url = checkWebSocketUrl("wss://abcdefghijklmnopqrst.supabase.co/realtime/v1/websocket", [
      project,
    ]);
    expect(url.host).toBe("abcdefghijklmnopqrst.supabase.co");
  });

  it("accepts ws on the test seam's origin", () => {
    const url = checkWebSocketUrl("ws://127.0.0.1:54321/realtime", ["http://127.0.0.1:54321"]);
    expect(url.port).toBe("54321");
  });

  it.each([
    "ws://abcdefghijklmnopqrst.supabase.co/x",
    "wss://evil.com/x",
    "wss://abcdefghijklmnopqrst.supabase.co.evil.com/x",
    "https://abcdefghijklmnopqrst.supabase.co/x",
    "ws://127.0.0.1:54321/x",
    "nope",
  ])("refuses %s", (url) => {
    expect(() => checkWebSocketUrl(url, [project])).toThrow(NetworkRefusedError);
  });
});

describe("createGuardedWebSocket", () => {
  const original = globalThis.WebSocket;
  const opened: string[] = [];

  class FakeSocket {
    readonly readyState = 0;
    constructor(url: string) {
      opened.push(url);
    }
  }

  function guarded(origins: string[] = [project, "http://127.0.0.1:54321"]) {
    vi.stubGlobal("WebSocket", FakeSocket);
    opened.length = 0;
    return createGuardedWebSocket(origins);
  }

  afterEach(() => {
    vi.stubGlobal("WebSocket", original);
    vi.unstubAllGlobals();
  });

  it("opens wss on the project and ws on the test seam", () => {
    const Guarded = guarded();
    new Guarded("wss://abcdefghijklmnopqrst.supabase.co/realtime/v1/websocket?vsn=1.0.0");
    new Guarded("ws://127.0.0.1:54321/realtime/v1/websocket");
    expect(opened).toHaveLength(2);
  });

  it.each([
    ["a wss lookalike", "wss://abcdefghijklmnopqrst.supabase.co.evil.example/realtime/v1"],
    ["an http address", "http://abcdefghijklmnopqrst.supabase.co/realtime/v1"],
    ["user info", "wss://user:pw@abcdefghijklmnopqrst.supabase.co/realtime/v1"],
    ["another host", "wss://other.supabase.co/realtime/v1"],
    ["plain ws on a real host", "ws://abcdefghijklmnopqrst.supabase.co/realtime/v1"],
    ["another local port", "ws://127.0.0.1:9999/realtime/v1"],
    ["a non-address", "not a url"],
  ])("refuses %s without opening a socket", (_name, url) => {
    const Guarded = guarded();
    expect(() => new Guarded(url)).toThrow(NetworkRefusedError);
    expect(opened).toHaveLength(0);
  });
});
