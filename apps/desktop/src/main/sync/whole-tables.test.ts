import { nameMax } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enqueue,
  getNotify,
  listConflicts,
  listMemberAccess,
  listProfiles,
  markResolved,
  setNotify,
  upsertProfile,
} from "../data/repositories";
import { openDatabase } from "../db/open-database";
import type { Rest } from "../supabase/rest";
import { RestError } from "../supabase/rest";

import { refreshWhole, toAppRole, toProfileRow } from "./whole-tables";

type Db = ReturnType<typeof openDatabase>;

const at = "2026-10-20T10:00:00.000Z";
const me = "u1";

function profile(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    display_name: `Name ${id}`,
    color: "#112233",
    role: "basic",
    created_at: at,
    updated_at: at,
    ...overrides,
  };
}

function conflict(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    channel_id: "UC1",
    channel_label: "@promptlab",
    field: "creator_stage",
    base_value: "replied",
    mine_value: "emailed",
    theirs_value: "signed",
    mine_actor_id: me,
    mine_actor_name: "Ada",
    theirs_actor_name: "Sara",
    detected_at: at,
    resolved_at: null,
    updated_at: at,
    ...overrides,
  };
}

function restWith(tables: Record<string, unknown[] | Error>) {
  const calls = vi.fn<(table: string, query: string) => Promise<unknown[]>>((table) => {
    const rows = tables[table];
    return rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows ?? []);
  });
  const rest: Pick<Rest, "select"> = { select: calls as Rest["select"] };
  return { rest, calls };
}

describe("refreshWhole", () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  it("replaces the profiles and the access with the server copy", async () => {
    upsertProfile(db, { id: "old", displayName: "Gone", role: "full" }, 0);
    const rest = restWith({
      profiles: [profile("a"), profile("b", { role: "full" })],
      member_access: [
        { profile_id: "a", roles: ["owner", "scout"], sees_money: true, updated_at: at },
        { profile_id: "b", roles: ["delivery", "chef"], sees_money: false, updated_at: at },
      ],
    });

    const changed = await refreshWhole(rest.rest, db, me);

    expect(listProfiles(db).map((p) => [p.id, p.displayName, p.role, p.color])).toEqual([
      ["a", "Name a", "basic", "#112233"],
      ["b", "Name b", "full", "#112233"],
    ]);
    const access = listMemberAccess(db);
    expect(access.get("a")).toEqual({ roles: ["owner", "scout"], seesMoney: true });
    expect(access.get("b")).toEqual({ roles: ["delivery"], seesMoney: false });
    expect(changed.has("team")).toBe(true);
    expect(rest.calls).toHaveBeenCalledWith(
      "profiles",
      "select=id,display_name,color,role,created_at,updated_at&order=created_at.asc,id.asc",
    );
    expect(rest.calls).toHaveBeenCalledWith(
      "member_access",
      "select=profile_id,roles,sees_money,updated_at",
    );
    expect(rest.calls).toHaveBeenCalledWith(
      "notification_switches",
      "select=profile_id,switches,updated_at&profile_id=eq.u1",
    );
    const asked = rest.calls.mock.calls.find(([t]) => t === "edit_conflicts")?.[1] ?? "";
    expect(asked).toContain("&mine_actor_id=eq.u1&resolved_at=is.null");
  });

  it("mends odd rows and drops broken ones", async () => {
    const rest = restWith({
      profiles: [
        profile("a", { display_name: "x".repeat(nameMax + 5), color: "red", role: "admin" }),
        profile("b", { display_name: null, color: null }),
        { display_name: "No id" },
        "not a row",
      ],
      member_access: [{ profile_id: "a", roles: null, sees_money: null, updated_at: at }, {}],
    });

    await refreshWhole(rest.rest, db, me);

    const rows = listProfiles(db);
    expect(rows.map((p) => p.id)).toEqual(["a", "b"]);
    expect(rows[0]?.displayName).toBe("x".repeat(nameMax));
    expect(rows[0]?.role).toBe("unauthorized");
    expect(rows[0]?.color).toBe("#3B82F6");
    expect(rows[1]?.displayName).toBe("");
    expect(listMemberAccess(db).get("a")).toEqual({ roles: [], seesMoney: false });
  });

  it("keeps the old team when the server cannot be reached", async () => {
    upsertProfile(db, { id: "kept", displayName: "Kept", role: "full" }, 0);
    const rest = restWith({ profiles: new RestError("offline"), member_access: [] });
    await expect(refreshWhole(rest.rest, db, me)).rejects.toThrow(RestError);
    expect(listProfiles(db).map((p) => p.id)).toEqual(["kept"]);
  });

  it("writes nothing when the database was closed while it waited", async () => {
    const rest = restWith({ profiles: [profile("a")], member_access: [] });
    db.close();
    await expect(refreshWhole(rest.rest, db, me)).resolves.toEqual(new Set());
  });

  it("reports nothing the second time when nothing changed", async () => {
    const rest = restWith({
      profiles: [profile(me), profile("b")],
      member_access: [],
      edit_conflicts: [conflict("c1")],
    });
    const first = await refreshWhole(rest.rest, db, me);
    expect([...first].sort()).toEqual(["conflicts", "me", "team"]);
    expect(await refreshWhole(rest.rest, db, me)).toEqual(new Set());
  });

  it("keeps a pending name and pending switches over the server copy", async () => {
    upsertProfile(db, { id: me, displayName: "Ada", role: "basic" }, 0);
    setNotify(db, { reply: false });
    enqueue(db, {
      userId: me,
      kind: "profile.name",
      payload: { name: "Ada L." },
      target: { table: "profiles", key: me },
      now: 1,
    });
    enqueue(db, {
      userId: me,
      kind: "notify.set",
      payload: { switches: { reply: false, money: true } },
      target: { table: "notification_switches", key: me },
      now: 2,
    });
    const rest = restWith({
      profiles: [profile(me, { display_name: "Server name" })],
      notification_switches: [
        { profile_id: me, switches: { reply: true, money: false }, updated_at: at },
      ],
    });

    await refreshWhole(rest.rest, db, me);

    expect(listProfiles(db)[0]?.displayName).toBe("Ada L.");
    expect(getNotify(db)).toEqual({ reply: false, money: true });
  });

  it("takes the server switches when nothing is pending, and keeps local ones without a row", async () => {
    setNotify(db, { reply: false });
    const none = restWith({ profiles: [profile(me)] });
    expect(await refreshWhole(none.rest, db, me)).toEqual(new Set(["me"]));
    expect(getNotify(db)).toEqual({ reply: false });

    const some = restWith({
      profiles: [profile(me)],
      notification_switches: [
        { profile_id: me, switches: { money: false, junk: true, search: "yes" }, updated_at: at },
      ],
    });
    const changed = await refreshWhole(some.rest, db, me);
    expect(getNotify(db)).toEqual({ money: false });
    expect(changed.has("notify")).toBe(true);
  });

  it("mirrors open conflicts as JSON text, removes dropped ones and keeps a local settling", async () => {
    const first = restWith({
      profiles: [profile(me)],
      edit_conflicts: [conflict("c1"), conflict("c2", { field: "notes", theirs_actor_name: null })],
    });
    await refreshWhole(first.rest, db, me);
    expect(listConflicts(db).map((c) => [c.id, c.mine, c.theirs, c.theirName])).toEqual([
      ["c1", "emailed", "signed", "Sara"],
      ["c2", "emailed", "signed", "someone"],
    ]);
    expect(db.prepare("SELECT mine_value FROM edit_conflicts WHERE id = 'c1'").get()).toEqual({
      mine_value: '"emailed"',
    });

    markResolved(db, "c1");
    const second = restWith({ profiles: [profile(me)], edit_conflicts: [conflict("c1")] });
    const changed = await refreshWhole(second.rest, db, me);
    expect(db.prepare("SELECT id FROM edit_conflicts").all()).toEqual([{ id: "c1" }]);
    expect(listConflicts(db)).toEqual([]);
    expect(changed.has("conflicts")).toBe(true);
  });

  it("runs afterConflicts inside the transaction and reports conflicts when it says so", async () => {
    const rest = restWith({ profiles: [profile(me)] });
    await refreshWhole(rest.rest, db, me);
    let inside = false;
    const changed = await refreshWhole(rest.rest, db, me, {
      afterConflicts: (d) => {
        inside = d.isTransaction;
        return true;
      },
    });
    expect(inside).toBe(true);
    expect(changed).toEqual(new Set(["conflicts"]));
  });

  it("changes nothing when a part fails", async () => {
    upsertProfile(db, { id: "kept", displayName: "Kept", role: "full" }, 0);
    const rest = restWith({ profiles: [profile("a")], edit_conflicts: new RestError("http", 500) });
    await expect(refreshWhole(rest.rest, db, me)).rejects.toThrow(RestError);
    expect(listProfiles(db).map((p) => p.id)).toEqual(["kept"]);
  });
});

describe("row helpers", () => {
  it("reads unknown access as unauthorized", () => {
    expect(toAppRole("basic")).toBe("basic");
    expect(toAppRole("full")).toBe("full");
    expect(toAppRole("owner")).toBe("unauthorized");
    expect(toAppRole(undefined)).toBe("unauthorized");
  });

  it("refuses a row without an id", () => {
    expect(toProfileRow({ ...profile("a"), id: "" })).toBeNull();
  });
});
