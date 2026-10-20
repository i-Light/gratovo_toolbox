import { describe, expect, it, vi } from "vitest";

import type { Network } from "../net/network";
import { AuthError } from "./auth-client";
import type { SupabaseConfig } from "./config";
import { RestError, createRest } from "./rest";
import type { Session } from "./session";

const config: SupabaseConfig = {
  url: "https://abcdefghijklmnopqrst.supabase.co",
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: "sb_publishable_test000",
};

function setup(...answers: (Response | Error)[]) {
  const request = vi.fn<Network["request"]>(() => {
    const next = answers.shift() ?? new Response("[]");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  let token = "access-1";
  const accessToken = vi.fn<Session["accessToken"]>((options = {}) => {
    if (options.rejected === token) {
      token = "access-2";
    }
    return Promise.resolve(token);
  });
  const rest = createRest({ request }, config, { accessToken });
  const call = (index: number) => {
    const [url, init] = request.mock.calls[index] ?? [];
    return { url, init, headers: init?.headers as Record<string, string> | undefined };
  };
  return { request, accessToken, rest, call };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("createRest", () => {
  it("selects with the key, the member's token and the public profile", async () => {
    const t = setup(json([{ id: "u1" }]));
    const rows = await t.rest.select<{ id: string }>("profiles", "select=id,role&id=eq.u1");

    expect(rows).toEqual([{ id: "u1" }]);
    const { url, init, headers } = t.call(0);
    expect(url).toBe(`${config.url}/rest/v1/profiles?select=id,role&id=eq.u1`);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(headers).toMatchObject({
      apikey: config.publishableKey,
      Authorization: "Bearer access-1",
      "Accept-Profile": "public",
    });
  });

  it("calls a function with its arguments and reads its result", async () => {
    const t = setup(json("yt-test-000"), new Response(null, { status: 204 }));
    expect(await t.rest.rpc<string>("team_youtube_key")).toBe("yt-test-000");
    expect(await t.rest.rpc("set_member_access", { p_roles: ["owner"] })).toBeNull();

    const first = t.call(0);
    expect(first.url).toBe(`${config.url}/rest/v1/rpc/team_youtube_key`);
    expect(first.init?.method).toBe("POST");
    expect(first.init?.body).toBe("{}");
    expect(first.headers).toMatchObject({
      "Content-Profile": "public",
      "Content-Type": "application/json",
    });
    expect(t.call(1).init?.body).toBe(JSON.stringify({ p_roles: ["owner"] }));
  });

  it("patches with a filter and asks for no answer body", async () => {
    const t = setup(new Response(null, { status: 204 }));
    await t.rest.patch("profiles", "id=eq.u1", { display_name: "Lina" });

    const { url, init, headers } = t.call(0);
    expect(url).toBe(`${config.url}/rest/v1/profiles?id=eq.u1`);
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ display_name: "Lina" }));
    expect(headers).toMatchObject({ "Content-Profile": "public", Prefer: "return=minimal" });
  });

  it("refuses a patch without a filter and a bad name, before sending", async () => {
    const t = setup();
    await expect(t.rest.patch("profiles", " ", {})).rejects.toThrow("filter");
    await expect(t.rest.select("profiles?x=1", "select=id")).rejects.toThrow("name");
    await expect(t.rest.rpc("../auth/v1/logout")).rejects.toThrow("name");
    expect(t.request).not.toHaveBeenCalled();
  });

  it("on a 401 refreshes once and tries again with the new token", async () => {
    const t = setup(json({ code: "PGRST303" }, 401), json([]));
    expect(await t.rest.select("member_access", "select=*")).toEqual([]);

    expect(t.request).toHaveBeenCalledTimes(2);
    expect(t.accessToken).toHaveBeenLastCalledWith({ rejected: "access-1" });
    expect(t.call(1).headers?.["Authorization"]).toBe("Bearer access-2");
  });

  it("gives up after a second 401", async () => {
    const t = setup(json({}, 401), json({ code: "PGRST301" }, 401));
    await expect(t.rest.select("profiles", "select=id")).rejects.toMatchObject({
      kind: "http",
      status: 401,
      code: "PGRST301",
    });
    expect(t.request).toHaveBeenCalledTimes(2);
  });

  it("reports PostgREST's code and status only", async () => {
    const t = setup(
      json({ code: "42501", message: "permission denied for lina@example.com", hint: "x" }, 403),
    );
    const error = await t.rest.rpc("team_youtube_key").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RestError);
    expect(error).toMatchObject({ kind: "http", status: 403, code: "42501" });
    const visible = `${(error as Error).message} ${JSON.stringify(error)}`;
    for (const hidden of ["lina@example.com", "permission denied", "access-1", config.url]) {
      expect(visible).not.toContain(hidden);
    }
  });

  it("drops a code that isn't an identifier", async () => {
    const t = setup(json({ code: "not a code at all" }, 500));
    await expect(t.rest.select("profiles", "select=id")).rejects.toMatchObject({
      status: 500,
      code: null,
    });
  });

  it("maps no answer to offline", async () => {
    const t = setup(new TypeError("fetch failed"));
    await expect(t.rest.select("profiles", "select=id")).rejects.toMatchObject({
      kind: "offline",
      status: null,
    });
  });

  it("refuses a select answer that isn't a list", async () => {
    const t = setup(json({ id: "u1" }));
    await expect(t.rest.select("profiles", "select=id")).rejects.toMatchObject({
      code: "bad_response",
    });
  });

  it("passes an ended session on as the AuthError, without sending", async () => {
    const t = setup();
    t.accessToken.mockRejectedValueOnce(new AuthError("ended"));
    await expect(t.rest.select("profiles", "select=id")).rejects.toBeInstanceOf(AuthError);
    expect(t.request).not.toHaveBeenCalled();
  });
});
