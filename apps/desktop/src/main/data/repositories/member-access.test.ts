import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";
import { listMemberAccess, replaceMemberAccess } from "./member-access";

let folder: string;
let db: DatabaseSync;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "gratovo-repo-"));
  db = openDatabase(join(folder, "test.db"));
});

afterEach(async () => {
  db.close();
  await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const stamp = "2026-10-20T10:00:00.123456+00:00";

describe("member access", () => {
  it("is empty in a fresh database", () => {
    expect(listMemberAccess(db).size).toBe(0);
  });

  it("round trips roles and the money switch", () => {
    replaceMemberAccess(db, [
      { profileId: "u1", roles: ["owner"], seesMoney: true, updatedAt: stamp },
      { profileId: "u3", roles: ["scout", "outreach"], seesMoney: false, updatedAt: stamp },
      { profileId: "u5", roles: [], seesMoney: true, updatedAt: stamp },
    ]);
    expect(Object.fromEntries(listMemberAccess(db))).toEqual({
      u1: { roles: ["owner"], seesMoney: true },
      u3: { roles: ["scout", "outreach"], seesMoney: false },
      u5: { roles: [], seesMoney: true },
    });
  });

  it("stores roles as a JSON array, 0 or 1 and the server's timestamp", () => {
    replaceMemberAccess(db, [
      { profileId: "u2", roles: ["deal_lead", "delivery"], seesMoney: true, updatedAt: stamp },
    ]);
    expect(db.prepare("SELECT * FROM member_access").get()).toMatchObject({
      profile_id: "u2",
      roles: '["deal_lead","delivery"]',
      sees_money: 1,
      updated_at: stamp,
    });
  });

  it("replaces every row", () => {
    replaceMemberAccess(db, [
      { profileId: "u1", roles: ["owner"], seesMoney: true, updatedAt: stamp },
      { profileId: "u2", roles: ["scout"], seesMoney: false, updatedAt: stamp },
    ]);
    replaceMemberAccess(db, [
      { profileId: "u2", roles: ["delivery"], seesMoney: true, updatedAt: stamp },
    ]);
    expect(Object.fromEntries(listMemberAccess(db))).toEqual({
      u2: { roles: ["delivery"], seesMoney: true },
    });
    replaceMemberAccess(db, []);
    expect(listMemberAccess(db).size).toBe(0);
  });

  it("reads roles in display order, each once, and drops unknown ones", () => {
    replaceMemberAccess(db, [
      {
        profileId: "u1",
        roles: ["delivery", "admin", "owner", "Owner", "delivery"],
        seesMoney: false,
        updatedAt: stamp,
      },
    ]);
    expect(listMemberAccess(db).get("u1")).toEqual({
      roles: ["owner", "delivery"],
      seesMoney: false,
    });
  });

  it("reads a row whose roles aren't a JSON array as no roles", () => {
    db.exec(
      `INSERT INTO member_access (profile_id, roles, sees_money, updated_at) VALUES
         ('a', 'not json', 1, 'x'), ('b', '{"owner":true}', 0, 'x'), ('c', '[1, null, "scout"]', 0, 'x')`,
    );
    const access = listMemberAccess(db);
    expect(access.get("a")).toEqual({ roles: [], seesMoney: true });
    expect(access.get("b")).toEqual({ roles: [], seesMoney: false });
    expect(access.get("c")).toEqual({ roles: ["scout"], seesMoney: false });
  });

  it("is STRICT about types", () => {
    expect(() => {
      db.exec(
        "INSERT INTO member_access (profile_id, roles, sees_money, updated_at) VALUES ('a', '[]', 'yes', 'x')",
      );
    }).toThrow();
  });
});
