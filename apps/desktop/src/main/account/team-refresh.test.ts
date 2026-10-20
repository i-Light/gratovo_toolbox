import { nameMax } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listMemberAccess, listProfiles, upsertProfile } from "../data/repositories";
import { openDatabase } from "../db/open-database";
import type { Rest } from "../supabase/rest";
import { RestError } from "../supabase/rest";

import { refreshTeam, toAppRole, toProfileRow } from "./team-refresh";

type Db = ReturnType<typeof openDatabase>;

const at = "2026-10-20T10:00:00.000Z";

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

function restWith(tables: Record<string, unknown[] | Error>) {
  const calls = vi.fn<(table: string, query: string) => Promise<unknown[]>>((table) => {
    const rows = tables[table];
    return rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows ?? []);
  });
  const rest: Pick<Rest, "select"> = { select: calls as Rest["select"] };
  return { rest, calls };
}

describe("refreshTeam", () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    if (db.isOpen) {
      db.close();
    }
  });

  it("replaces the profiles and the access with the server's", async () => {
    upsertProfile(db, { id: "old", displayName: "Gone", role: "full" }, 0);
    const rest = restWith({
      profiles: [profile("a"), profile("b", { role: "full" })],
      member_access: [
        { profile_id: "a", roles: ["owner", "scout"], sees_money: true, updated_at: at },
        { profile_id: "b", roles: ["delivery", "chef"], sees_money: false, updated_at: at },
      ],
    });

    await refreshTeam(rest.rest, db);

    expect(listProfiles(db).map((p) => [p.id, p.displayName, p.role, p.color])).toEqual([
      ["a", "Name a", "basic", "#112233"],
      ["b", "Name b", "full", "#112233"],
    ]);
    const access = listMemberAccess(db);
    expect(access.get("a")).toEqual({ roles: ["owner", "scout"], seesMoney: true });
    expect(access.get("b")).toEqual({ roles: ["delivery"], seesMoney: false });
    expect(rest.calls).toHaveBeenCalledWith(
      "profiles",
      "select=id,display_name,color,role,created_at,updated_at&order=created_at.asc,id.asc",
    );
    expect(rest.calls).toHaveBeenCalledWith(
      "member_access",
      "select=profile_id,roles,sees_money,updated_at",
    );
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

    await refreshTeam(rest.rest, db);

    const rows = listProfiles(db);
    expect(rows.map((p) => p.id)).toEqual(["a", "b"]);
    expect(rows[0]?.displayName).toBe("x".repeat(nameMax));
    expect(rows[0]?.role).toBe("unauthorized");
    expect(rows[0]?.color).toBe("#3B82F6");
    expect(rows[1]?.displayName).toBe("");
    expect(listMemberAccess(db).get("a")).toEqual({ roles: [], seesMoney: false });
  });

  it("keeps the old team when the server can't be reached", async () => {
    upsertProfile(db, { id: "kept", displayName: "Kept", role: "full" }, 0);
    const rest = restWith({ profiles: new RestError("offline"), member_access: [] });
    await expect(refreshTeam(rest.rest, db)).rejects.toThrow(RestError);
    expect(listProfiles(db).map((p) => p.id)).toEqual(["kept"]);
  });

  it("writes nothing when the database was closed while it waited", async () => {
    const rest = restWith({ profiles: [profile("a")], member_access: [] });
    db.close();
    await expect(refreshTeam(rest.rest, db)).resolves.toBeUndefined();
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
