import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { createNetwork, listenOnLoopback, type LoopbackHandler } from "../net/network";
import {
  createMailConsent,
  gmailScopes,
  googleTokenUrl,
  type MailConsentDeps,
  type SaveMailboxResult,
} from "./consent";

const client = { id: "1234-abc.apps.googleusercontent.com", secret: "GOCSPX-client-secret-value" };
const code = "4/0AcodeFromGoogle";
const refreshToken = "1//refresh-token-value";
const address = "sam@aiexplained.example";

function base64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function idToken(claims: Record<string, unknown>): string {
  return `${base64url('{"alg":"RS256"}')}.${base64url(JSON.stringify(claims))}.c2lnbmF0dXJl`;
}

const goodClaims = {
  iss: "https://accounts.google.com",
  aud: client.id,
  email: "Sam@AIExplained.example",
  email_verified: true,
};

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A raw request to the loopback listener, so the test controls the method and Host header. */
function send(
  port: number,
  path: string,
  options: { method?: string; host?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: { Host: options.host ?? `127.0.0.1:${String(port)}` },
        agent: false,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

type Browser = (auth: URL, port: number) => Promise<void>;

/** The browser comes back with these query parameters (the state is filled in when `true`). */
function redirectWith(params: Record<string, string>): Browser {
  return async (auth, port) => {
    const query = new URLSearchParams(params);
    query.set("state", auth.searchParams.get("state") ?? "");
    await send(port, `/?${query.toString()}`);
  };
}

interface SetupOptions {
  browser?: Browser;
  token?: () => Response;
  saveMailbox?: SaveMailboxResult;
  readClient?: MailConsentDeps["readClient"];
  canAddMailbox?: MailConsentDeps["canAddMailbox"];
  timeoutMs?: number;
}

function setup(options: SetupOptions = {}) {
  const log = vi.fn<(line: string) => void>();
  const opened: URL[] = [];
  const browserRuns: Promise<void>[] = [];
  const servers: { port: number; closed: boolean }[] = [];
  const tokenFetch = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      options.token?.() ??
        Response.json({
          access_token: "ya29.access",
          refresh_token: refreshToken,
          id_token: idToken(goodClaims),
          expires_in: 3599,
          token_type: "Bearer",
        }),
    ),
  );
  const saveMailbox = vi.fn<MailConsentDeps["saveMailbox"]>(() =>
    Promise.resolve(options.saveMailbox ?? { ok: true }),
  );
  const listen = async (handler: LoopbackHandler) => {
    const server = await listenOnLoopback(handler);
    const entry = { port: server.port, closed: false };
    servers.push(entry);
    return {
      port: server.port,
      close: async () => {
        await server.close();
        entry.closed = true;
      },
    };
  };
  const browser = options.browser ?? redirectWith({ code, scope: gmailScopes });
  const consent = createMailConsent({
    readClient: options.readClient ?? (() => Promise.resolve(client)),
    openExternal: (url) => {
      const auth = new URL(url);
      opened.push(auth);
      const port = Number(new URL(auth.searchParams.get("redirect_uri") ?? "").port);
      browserRuns.push(browser(auth, port));
      return Promise.resolve();
    },
    network: createNetwork({
      allowedOrigins: ["https://oauth2.googleapis.com"],
      fetch: tokenFetch,
    }),
    saveMailbox,
    ...(options.canAddMailbox === undefined ? {} : { canAddMailbox: options.canAddMailbox }),
    log,
    timeoutMs: options.timeoutMs ?? 5_000,
    listen,
  });
  return { consent, log, opened, browserRuns, servers, tokenFetch, saveMailbox };
}

type Setup = ReturnType<typeof setup>;

/** The form body of the one token request. */
function sentForm({ tokenFetch }: Setup): URLSearchParams {
  const body = tokenFetch.mock.calls[0]?.[1]?.body;
  expect(typeof body).toBe("string");
  return new URLSearchParams(typeof body === "string" ? body : "");
}

/** Every listener opened is closed, and nothing answers on its port any more. */
async function expectClosed({ servers }: Setup) {
  expect(servers.length).toBeGreaterThan(0);
  for (const server of servers) {
    expect(server.closed).toBe(true);
    await expect(send(server.port, "/")).rejects.toThrow();
  }
}

/** No log line carries a code, token, verifier, state, secret or address. */
function expectNoSecretsLogged({ log, opened, tokenFetch }: Setup) {
  const secrets = [code, refreshToken, client.secret, address, "sam@", "ya29.access"];
  const auth = opened[0];
  if (auth !== undefined) {
    secrets.push(
      auth.searchParams.get("state") ?? "",
      auth.searchParams.get("code_challenge") ?? "",
    );
  }
  const sent = tokenFetch.mock.calls[0]?.[1]?.body;
  if (typeof sent === "string") {
    secrets.push(new URLSearchParams(sent).get("code_verifier") ?? "");
  }
  const lines = log.mock.calls.map(([line]) => line.toLowerCase());
  for (const secret of secrets.filter((value) => value !== "")) {
    for (const line of lines) {
      expect(line).not.toContain(secret.toLowerCase());
    }
  }
}

describe("createMailConsent", () => {
  it("connects a mailbox end to end", async () => {
    const context = setup();
    const result = await context.consent.connect();
    expect(result).toEqual({ ok: true, address });

    const auth = context.opened[0];
    expect(`${auth?.origin ?? ""}${auth?.pathname ?? ""}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    const params = auth?.searchParams;
    const port = context.servers[0]?.port ?? 0;
    expect(params?.get("client_id")).toBe(client.id);
    expect(params?.get("redirect_uri")).toBe(`http://127.0.0.1:${String(port)}/`);
    expect(params?.get("response_type")).toBe("code");
    expect(params?.get("scope")).toBe(gmailScopes);
    expect(params?.get("code_challenge_method")).toBe("S256");
    expect(params?.get("access_type")).toBe("offline");
    expect(params?.get("prompt")).toBe("consent");
    expect(params?.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(context.tokenFetch).toHaveBeenCalledOnce();
    const [url, init] = context.tokenFetch.mock.calls[0] ?? [];
    expect(url).toBe(googleTokenUrl);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    const body = sentForm(context);
    expect(Object.fromEntries(body)).toEqual({
      code,
      client_id: client.id,
      client_secret: client.secret,
      redirect_uri: `http://127.0.0.1:${String(port)}/`,
      grant_type: "authorization_code",
      code_verifier: body.get("code_verifier"),
    });

    expect(context.saveMailbox).toHaveBeenCalledExactlyOnceWith(address, refreshToken);
    await expectClosed(context);
    expectNoSecretsLogged(context);
  });

  it("sends a PKCE verifier whose S256 hash is the challenge", async () => {
    const context = setup();
    await context.consent.connect();
    const challenge = context.opened[0]?.searchParams.get("code_challenge");
    const verifier = sentForm(context).get("code_verifier") ?? "";
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
    expect(verifier).not.toBe(context.opened[0]?.searchParams.get("state"));
  });

  it("answers the browser with a static page under a strict CSP", async () => {
    let reply: Reply | undefined;
    const context = setup({
      browser: async (auth, port) => {
        const state = auth.searchParams.get("state") ?? "";
        reply = await send(port, `/?state=${state}&code=%3Cscript%3Ealert(1)%3C%2Fscript%3E`);
      },
    });
    expect((await context.consent.connect()).ok).toBe(true);
    await Promise.all(context.browserRuns);
    expect(reply?.status).toBe(200);
    expect(reply?.headers["content-security-policy"]).toBe("default-src 'none'");
    expect(reply?.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(reply?.headers["cache-control"]).toBe("no-store");
    expect(reply?.body).toContain("You can close this tab and go back to Gratovo.");
    expect(reply?.body).not.toContain("<script");
    expect(reply?.body).not.toContain("alert");
    expect(reply?.body).not.toContain(context.opened[0]?.searchParams.get("state") ?? "-");
  });

  it("fails with bad_state on a wrong state, and reflects nothing", async () => {
    let reply: Reply | undefined;
    const context = setup({
      browser: async (_auth, port) => {
        reply = await send(port, `/?state=forged%3Cb%3E&code=${code}`);
      },
    });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "bad_state" });
    await Promise.all(context.browserRuns);
    expect(reply?.status).toBe(400);
    expect(reply?.headers["content-security-policy"]).toBe("default-src 'none'");
    expect(reply?.body).toContain("couldn't connect this mailbox");
    expect(reply?.body).not.toContain("forged");
    expect(context.tokenFetch).not.toHaveBeenCalled();
    await expectClosed(context);
    expectNoSecretsLogged(context);
  });

  it("fails with bad_state when the state is missing or repeated", async () => {
    const missing = setup({
      browser: async (_auth, port) => {
        await send(port, `/?code=${code}`);
      },
    });
    expect(await missing.consent.connect()).toEqual({ ok: false, reason: "bad_state" });
    const repeated = setup({
      browser: async (auth, port) => {
        const state = auth.searchParams.get("state") ?? "";
        await send(port, `/?state=${state}&state=${state}&code=${code}`);
      },
    });
    expect(await repeated.consent.connect()).toEqual({ ok: false, reason: "bad_state" });
  });

  it("reports denied when the person says no", async () => {
    const context = setup({ browser: redirectWith({ error: "access_denied" }) });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "denied" });
    expect(context.tokenFetch).not.toHaveBeenCalled();
    await expectClosed(context);
  });

  it("reports failed for another error from Google", async () => {
    const context = setup({ browser: redirectWith({ error: "server_error" }) });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "failed" });
  });

  it("reports bad_response when the code is missing", async () => {
    const context = setup({ browser: redirectWith({ scope: gmailScopes }) });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "bad_response" });
    expect(context.tokenFetch).not.toHaveBeenCalled();
    await expectClosed(context);
  });

  it("times out when the browser never comes back", async () => {
    const context = setup({ browser: () => Promise.resolve(), timeoutMs: 100 });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "timeout" });
    expect(context.tokenFetch).not.toHaveBeenCalled();
    await expectClosed(context);
    expectNoSecretsLogged(context);
  });

  it("runs one connect at a time", async () => {
    const context = setup({ browser: () => Promise.resolve(), timeoutMs: 200 });
    const first = context.consent.connect();
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "busy" });
    expect(await first).toEqual({ ok: false, reason: "timeout" });
    expect(context.servers).toHaveLength(1);
    await expectClosed(context);
  });

  it("can connect again after one ends", async () => {
    const context = setup({ browser: redirectWith({ error: "access_denied" }) });
    expect((await context.consent.connect()).ok).toBe(false);
    expect((await context.consent.connect()).ok).toBe(false);
    expect(context.servers).toHaveLength(2);
    await expectClosed(context);
  });

  it("answers no_client without opening anything", async () => {
    const context = setup({ readClient: () => Promise.resolve(null) });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "no_client" });
    expect(context.opened).toHaveLength(0);
    expect(context.servers).toHaveLength(0);
  });

  it("answers too_many before the browser opens when no mailbox fits", async () => {
    const context = setup({ canAddMailbox: () => false });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "too_many" });
    expect(context.opened).toHaveLength(0);
    expect(context.servers).toHaveLength(0);
    expect(context.saveMailbox).not.toHaveBeenCalled();
  });

  it("reports exchange_failed on a refused exchange and logs only the status", async () => {
    const context = setup({
      token: () =>
        Response.json(
          { error: "invalid_grant", error_description: `bad code ${code}` },
          { status: 400 },
        ),
    });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "exchange_failed" });
    expect(context.log).toHaveBeenCalledWith("Mail consent: the token exchange answered 400.");
    expect(context.log.mock.calls.flat().join("\n")).not.toContain("invalid_grant");
    expect(context.saveMailbox).not.toHaveBeenCalled();
    await expectClosed(context);
    expectNoSecretsLogged(context);
  });

  it("reports no_refresh_token when Google gives none", async () => {
    const context = setup({
      token: () => Response.json({ access_token: "ya29.access", id_token: idToken(goodClaims) }),
    });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "no_refresh_token" });
    expect(context.saveMailbox).not.toHaveBeenCalled();
  });

  it.each([
    ["no id_token", undefined],
    ["another client", idToken({ ...goodClaims, aud: "other.apps.googleusercontent.com" })],
    ["several audiences", idToken({ ...goodClaims, aud: [client.id, "other"] })],
    ["another issuer", idToken({ ...goodClaims, iss: "https://evil.example" })],
    ["no issuer", idToken({ ...goodClaims, iss: undefined })],
    ["an unverified address", idToken({ ...goodClaims, email_verified: false })],
    ["an unverified address as text", idToken({ ...goodClaims, email_verified: "false" })],
    ["no address", idToken({ ...goodClaims, email: undefined })],
    ["a malformed address", idToken({ ...goodClaims, email: "not an address" })],
    ["a header-breaking address", idToken({ ...goodClaims, email: "sam@x.example\r\nBcc: y" })],
    ["two parts", "abc.def"],
    ["a body that isn't base64url", "abc.d+f/.sig"],
    ["a body that isn't JSON", `abc.${base64url("not json")}.sig`],
    ["a body that is an array", `abc.${base64url("[1]")}.sig`],
  ])("reports bad_response for an id_token with %s", async (_name, token) => {
    const context = setup({
      token: () => Response.json({ refresh_token: refreshToken, id_token: token }),
    });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "bad_response" });
    expect(context.saveMailbox).not.toHaveBeenCalled();
    expectNoSecretsLogged(context);
  });

  it("accepts the issuer without a scheme", async () => {
    const context = setup({
      token: () =>
        Response.json({
          refresh_token: refreshToken,
          id_token: idToken({ ...goodClaims, iss: "accounts.google.com" }),
        }),
    });
    expect(await context.consent.connect()).toEqual({ ok: true, address });
  });

  it("reports bad_response when the token answer is not JSON", async () => {
    const context = setup({ token: () => new Response("<html>oops</html>", { status: 200 }) });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "bad_response" });
  });

  it("passes on saveMailbox's failure", async () => {
    const context = setup({ saveMailbox: { ok: false, reason: "too_many" } });
    expect(await context.consent.connect()).toEqual({ ok: false, reason: "too_many" });
    expect(context.saveMailbox).toHaveBeenCalledOnce();
    await expectClosed(context);
  });

  it("ignores the favicon and other stray requests, then takes the real redirect", async () => {
    const strays: Reply[] = [];
    const context = setup({
      browser: async (auth, port) => {
        const state = auth.searchParams.get("state") ?? "";
        const good = `/?state=${state}&code=${code}`;
        strays.push(await send(port, "/favicon.ico"));
        strays.push(await send(port, good, { method: "POST" }));
        strays.push(await send(port, good, { host: `localhost:${String(port)}` }));
        strays.push(await send(port, `/other?state=${state}&code=${code}`));
        strays.push(await send(port, `//evil.example/?state=${state}&code=${code}`));
        await send(port, good);
      },
    });
    expect(await context.consent.connect()).toEqual({ ok: true, address });
    await Promise.all(context.browserRuns);
    expect(strays.map((reply) => reply.status)).toEqual([404, 405, 400, 404, 404]);
    for (const reply of strays) {
      expect(reply.body).toBe("");
    }
    expect(context.tokenFetch).toHaveBeenCalledOnce();
  });

  it("accepts only the first redirect", async () => {
    let second: Reply | undefined;
    const context = setup({
      browser: async (auth, port) => {
        const state = auth.searchParams.get("state") ?? "";
        const [, again] = await Promise.all([
          send(port, `/?state=${state}&code=${code}`),
          send(port, `/?state=${state}&code=another-code`).catch(() => undefined),
        ]);
        second = again;
      },
    });
    expect(await context.consent.connect()).toEqual({ ok: true, address });
    await Promise.all(context.browserRuns);
    expect(context.tokenFetch).toHaveBeenCalledOnce();
    expect(second === undefined || second.status === 404).toBe(true);
  });

  it("refuses to send the code anywhere but the allowlisted token endpoint", async () => {
    const context = setup();
    const consent = createMailConsent({
      readClient: () => Promise.resolve(client),
      openExternal: (url) => {
        const auth = new URL(url);
        const port = Number(new URL(auth.searchParams.get("redirect_uri") ?? "").port);
        void redirectWith({ code })(auth, port);
        return Promise.resolve();
      },
      network: createNetwork({ allowedOrigins: [], fetch: context.tokenFetch }),
      saveMailbox: context.saveMailbox,
      log: context.log,
      timeoutMs: 5_000,
    });
    expect(await consent.connect()).toEqual({ ok: false, reason: "failed" });
    expect(context.tokenFetch).not.toHaveBeenCalled();
    expect(context.log).toHaveBeenCalledWith(
      "Mail consent: failed unexpectedly (NetworkRefusedError).",
    );
  });

  it("closes the listener and answers failed when the browser can't be opened", async () => {
    const servers: number[] = [];
    let closed = 0;
    const log = vi.fn<(line: string) => void>();
    const consent = createMailConsent({
      readClient: () => Promise.resolve(client),
      openExternal: (url) => Promise.reject(new Error(`refused ${url}`)),
      network: createNetwork({ allowedOrigins: [] }),
      saveMailbox: () => Promise.resolve({ ok: true }),
      log,
      listen: async (handler) => {
        const server = await listenOnLoopback(handler);
        servers.push(server.port);
        return {
          port: server.port,
          close: async () => {
            closed += 1;
            await server.close();
          },
        };
      },
    });
    expect(await consent.connect()).toEqual({ ok: false, reason: "failed" });
    expect(closed).toBe(1);
    await expect(send(servers[0] ?? 0, "/")).rejects.toThrow();
    expect(log.mock.calls.flat().join("\n")).not.toContain("accounts.google.com");
  });
});
