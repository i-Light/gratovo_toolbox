import type { Page } from "@playwright/test";

import { strings } from "../src/renderer/strings";
import type { FakeSupabase } from "./fake-supabase";
import { expect, syncNow, test } from "./fixtures";

const text = strings.auth.signIn;
const rail = (page: Page) => page.getByRole("navigation", { name: strings.rail.label });

// The niche: a creator who covers AI tools, a brand that sponsors creators like them.
const creator = { channel_id: "UC-e2e-tokenwise", handle: "@tokenwise" };
const brand = { id: "b-e2e-draftwise", name: "Draftwise AI" };
const deal = {
  id: "d-e2e-draftwise-tokenwise",
  brand_id: brand.id,
  channel_id: creator.channel_id,
};

interface FrameView {
  readonly ok: boolean;
  readonly value?: {
    readonly creators: readonly { readonly id: string; readonly stage: string }[];
    readonly notifications: readonly { readonly id: string; readonly text: string }[];
  };
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel(text.email).fill(email);
  await page.getByLabel(text.password, { exact: true }).fill(password);
  await page.getByRole("button", { name: text.submit, exact: true }).click();
  // Sign-in waits for the team to load first; a busy CI runner needs more than the default 5 s.
  await expect(rail(page)).toBeVisible({ timeout: 15_000 });
}

/** Writes go through the bridge: no screen edits a stage, a brand or a deal step yet (steps 5 to 8). */
async function write(page: Page, writes: object[]): Promise<unknown> {
  return page.evaluate((sent) => window.gratovo.invoke("data:write", { writes: sent }), writes);
}

async function frame(page: Page): Promise<FrameView> {
  return page.evaluate(() => window.gratovo.invoke("frame:load", {}) as Promise<FrameView>);
}

async function stageOf(page: Page, id: string): Promise<string | undefined> {
  return (await frame(page)).value?.creators.find((c) => c.id === id)?.stage;
}

async function notificationIds(page: Page): Promise<string[]> {
  return ((await frame(page)).value?.notifications ?? []).map((n) => n.id);
}

/** The bodies the app sent to an RPC, in order. */
function rpcBodies(supabase: FakeSupabase, name: string): Record<string, unknown>[] {
  return supabase
    .sent("POST", `/rest/v1/rpc/${name}`)
    .map((request) => request.body as Record<string, unknown>);
}

test.describe("edits with the compare-and-set, against a fake Supabase", () => {
  test("a stage, a brand and a deal step reach the server with only their columns", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addRows("channel_state", [creator]);
    supabase.addRows("brands", [brand]);
    supabase.addRows("deals", [deal]);
    // The server applies what it is sent, as apply_channel_edit does when the base matches.
    supabase.scriptRpc("apply_channel_edit", (args: Record<string, unknown>) => {
      supabase.updateRow("channel_state", String(args["p_channel_id"]), {
        [String(args["p_field"])]: args["p_new"],
      });
      return "applied";
    });
    const member = supabase.addUser({ email: "sam@example.com", role: "basic", roles: ["scout"] });
    const { page } = await startSigned({ ready: "page" });
    await signIn(page, member.email, member.password);
    await syncNow(page);

    // The first stage edit has no base; the next one sends the stage it replaces.
    expect(
      await write(page, [
        {
          kind: "creator.stage",
          id: creator.channel_id,
          stage: "shortlisted",
          handle: creator.handle,
          name: creator.handle,
        },
      ]),
    ).toMatchObject({ ok: true });
    await syncNow(page);
    expect(
      await write(page, [
        {
          kind: "creator.stage",
          id: creator.channel_id,
          stage: "emailed",
          handle: creator.handle,
          name: creator.handle,
        },
      ]),
    ).toMatchObject({ ok: true });
    await syncNow(page);
    await expect.poll(() => rpcBodies(supabase, "apply_channel_edit").length).toBe(2);
    const [first, second] = rpcBodies(supabase, "apply_channel_edit");
    expect(first).toMatchObject({
      p_channel_id: creator.channel_id,
      p_field: "creator_stage",
      p_base: null,
      p_new: "shortlisted",
      p_force: false,
    });
    expect(second).toMatchObject({
      p_field: "creator_stage",
      p_base: "shortlisted",
      p_new: "emailed",
    });

    // A brand goes up as an upsert of its own columns; a deal's step as a PATCH of one column.
    expect(
      await write(page, [
        {
          kind: "brand.set",
          id: brand.id,
          name: brand.name,
          sells: "An AI writing assistant",
          status: "contacted",
        },
        { kind: "deal.step", id: deal.id, step: 3 },
      ]),
    ).toMatchObject({ ok: true });
    await syncNow(page);
    await expect.poll(() => supabase.sent("POST", "/rest/v1/brands").length).toBe(1);
    const [brandPost] = supabase.sent("POST", "/rest/v1/brands");
    expect(brandPost?.body).toEqual([
      { id: brand.id, name: brand.name, sells: "An AI writing assistant", status: "contacted" },
    ]);
    await expect.poll(() => supabase.sent("PATCH", "/rest/v1/deals").length).toBe(1);
    const [dealPatch] = supabase.sent("PATCH", "/rest/v1/deals");
    expect(dealPatch?.body).toEqual({ flow_step: 3 });
    expect(dealPatch?.path).toContain(`id=eq.${deal.id}`);

    expect(supabase.deletes()).toEqual([]);
    expect(signedErrors).toEqual([]);
  });

  test("a clash shows, the server's stage wins locally, and Use mine settles it", async ({
    supabase,
    startSigned,
    signedErrors,
  }) => {
    supabase.addRows("channel_state", [{ ...creator, creator_stage: "emailed" }]);
    const member = supabase.addUser({ email: "sam@example.com", role: "basic", roles: ["scout"] });
    supabase.addUser({ email: "maya@example.com", role: "full", roles: ["owner"] });
    const conflictId = "11111111-2222-4333-8444-555555555555";

    // A teammate moved the creator on first: the server keeps theirs and files the clash.
    supabase.scriptRpc("apply_channel_edit", (args: Record<string, unknown>) => {
      supabase.updateRow("channel_state", creator.channel_id, { creator_stage: "replied" });
      supabase.addRows("edit_conflicts", [
        {
          id: conflictId,
          channel_id: creator.channel_id,
          channel_label: creator.handle,
          field: "creator_stage",
          base_value: args["p_base"],
          mine_value: args["p_new"],
          theirs_value: "replied",
          mine_actor_id: member.id,
          mine_actor_name: "sam",
          theirs_actor_name: "Maya",
          detected_at: new Date().toISOString(),
          resolved_at: null,
        },
      ]);
      return "conflict";
    });
    supabase.scriptRpc("resolve_edit_conflict", (args: Record<string, unknown>) => {
      const open = supabase.rows("edit_conflicts").find((row) => row["id"] === args["p_id"]);
      if (open !== undefined) {
        Object.assign(open, { resolved_at: new Date().toISOString() });
      }
      supabase.updateRow("channel_state", creator.channel_id, { creator_stage: args["p_value"] });
      return "applied";
    });

    const { page } = await startSigned({ ready: "page" });
    await signIn(page, member.email, member.password);
    await syncNow(page);
    await expect.poll(() => stageOf(page, creator.channel_id)).toBe("emailed");

    expect(
      await write(page, [
        {
          kind: "creator.stage",
          id: creator.channel_id,
          stage: "contact",
          handle: creator.handle,
          name: creator.handle,
        },
      ]),
    ).toMatchObject({ ok: true });
    await syncNow(page);

    // The clash reaches the page: its toast and its notification, and the creator shows theirs.
    const toastText = strings.conflicts.toast(creator.handle, "Maya");
    await expect(page.getByText(toastText)).toBeVisible();
    await expect.poll(() => notificationIds(page)).toContain(`conflict:${conflictId}`);
    await expect.poll(() => stageOf(page, creator.channel_id)).toBe("replied");

    await page.getByRole("button", { name: strings.conflicts.useMine, exact: true }).click();
    await syncNow(page);
    await expect.poll(() => rpcBodies(supabase, "resolve_edit_conflict").length).toBe(1);
    expect(rpcBodies(supabase, "resolve_edit_conflict")[0]).toMatchObject({
      p_id: conflictId,
      p_resolution: "mine",
    });

    // Settled: the notification goes and the creator holds the chosen stage.
    await expect
      .poll(async () => {
        await syncNow(page);
        return notificationIds(page);
      })
      .not.toContain(`conflict:${conflictId}`);
    await expect.poll(() => stageOf(page, creator.channel_id)).toBe("contact");
    expect(supabase.deletes()).toEqual([]);
    expect(signedErrors).toEqual([]);
  });
});
