import type { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Creator } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";
import { listBrands, upsertBrand } from "./brands";
import { listCreators, upsertCreator } from "./creators";

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

const t0 = Date.UTC(2026, 9, 20, 10, 0, 0);

function row(sql: string): Record<string, unknown> {
  return db.prepare(sql).get() ?? {};
}

describe("creators", () => {
  it("round trips and writes app and legacy columns", () => {
    upsertCreator(
      db,
      {
        id: "UC1",
        name: "Prompt Lab",
        handle: "@promptlab",
        stage: "replied",
        email: "hi@promptlab.example",
      },
      t0,
    );
    expect(listCreators(db)).toEqual([
      {
        id: "UC1",
        name: "Prompt Lab",
        handle: "@promptlab",
        stage: "replied",
        email: "hi@promptlab.example",
        emailConfirmed: false,
        contactName: null,
        contactSource: null,
        contactConfidence: null,
        rejectReason: null,
        rejectedAt: null,
        neverReason: null,
        archiveDueAt: null,
        kit: null,
      },
    ]);
    expect(row("SELECT * FROM channel_state")).toMatchObject({
      creator_stage: "replied",
      vetting_status: "shortlisted",
      pipeline_stage: "interested",
      updated_at: "2026-10-20T10:00:00.000Z",
    });
    expect(row("SELECT name FROM channels")["name"]).toBe("Prompt Lab");
  });

  it("updates in place, keeps order, and keeps non-email contacts", () => {
    upsertCreator(
      db,
      { id: "UC1", name: "A", handle: "@a", stage: "new", email: "a@x.example" },
      t0,
    );
    upsertCreator(db, { id: "UC2", name: "B", handle: "@b", stage: "new", email: null }, t0);
    db.prepare("UPDATE channel_state SET contacts = ? WHERE channel_id = 'UC1'").run(
      JSON.stringify([
        { method: "twitter", value: "@a" },
        { method: "email", value: "a@x.example", primary: true },
      ]),
    );
    upsertCreator(
      db,
      { id: "UC1", name: "A2", handle: "@a2", stage: "signed", email: "new@x.example" },
      t0 + 1,
    );
    const list = listCreators(db);
    expect(list.map((c) => c.id)).toEqual(["UC1", "UC2"]);
    expect(list[0]).toMatchObject({
      name: "A2",
      handle: "@a2",
      stage: "signed",
      email: "new@x.example",
    });
    expect(list[1]?.email).toBeNull();
    const contacts = JSON.parse(
      String(row("SELECT contacts FROM channel_state WHERE channel_id = 'UC1'")["contacts"]),
    ) as unknown[];
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toEqual({ method: "twitter", value: "@a" });
    upsertCreator(
      db,
      { id: "UC1", name: "A2", handle: "@a2", stage: "signed", email: null },
      t0 + 2,
    );
    expect(listCreators(db)[0]?.email).toBeNull();
  });

  it("replaces only the primary email entry and keeps other emails", () => {
    upsertCreator(db, { id: "UC1", name: "A", handle: "@a", stage: "new", email: null }, t0);
    db.prepare("UPDATE channel_state SET contacts = ? WHERE channel_id = 'UC1'").run(
      JSON.stringify([
        { method: "email", value: "manager@x.example" },
        { method: "email", value: "old@x.example", primary: true },
      ]),
    );
    upsertCreator(
      db,
      { id: "UC1", name: "A", handle: "@a", stage: "new", email: "new@x.example" },
      t0,
    );
    const read = (): unknown[] =>
      JSON.parse(
        String(row("SELECT contacts FROM channel_state WHERE channel_id = 'UC1'")["contacts"]),
      ) as unknown[];
    expect(read()).toEqual([
      { method: "email", value: "manager@x.example" },
      { method: "email", value: "new@x.example", primary: true },
    ]);
    expect(listCreators(db)[0]?.email).toBe("new@x.example");
  });

  it("reads the primary email's confirmed flag, and false for anything else", () => {
    upsertCreator(db, { id: "UC1", name: "A", handle: "@a", stage: "new", email: null }, t0);
    const confirmed = (contacts: unknown) => {
      db.prepare("UPDATE channel_state SET contacts = ? WHERE channel_id = 'UC1'").run(
        typeof contacts === "string" ? contacts : JSON.stringify(contacts),
      );
      return listCreators(db)[0]?.emailConfirmed;
    };
    const primary = { method: "email", value: "a@x.example", primary: true };
    expect(confirmed([{ ...primary, confirmed: true }])).toBe(true);
    expect(confirmed([primary])).toBe(false);
    expect(confirmed([{ ...primary, confirmed: "yes" }])).toBe(false);
    // A confirmed address that isn't the primary one doesn't count.
    expect(confirmed([primary, { method: "email", value: "b@x.example", confirmed: true }])).toBe(
      false,
    );
    expect(confirmed([])).toBe(false);
    expect(confirmed("not json")).toBe(false);
  });

  it("replaces a bare-string primary email and adds one when there is none", () => {
    upsertCreator(db, { id: "UC1", name: "A", handle: "@a", stage: "new", email: null }, t0);
    const set = (contacts: unknown[]) =>
      db
        .prepare("UPDATE channel_state SET contacts = ? WHERE channel_id = 'UC1'")
        .run(JSON.stringify(contacts));
    const read = (): unknown[] =>
      JSON.parse(
        String(row("SELECT contacts FROM channel_state WHERE channel_id = 'UC1'")["contacts"]),
      ) as unknown[];
    const creator: Creator = {
      id: "UC1",
      name: "A",
      handle: "@a",
      stage: "new",
      email: "new@x.example",
      emailConfirmed: false,
      contactName: null,
      contactSource: null,
      contactConfidence: null,
      rejectReason: null,
      rejectedAt: null,
      neverReason: null,
      archiveDueAt: null,
      kit: null,
    };
    set(["bare@x.example", 7, { method: "twitter", value: "@a" }]);
    upsertCreator(db, creator, t0);
    expect(read()).toEqual([
      7,
      { method: "twitter", value: "@a" },
      { method: "email", value: "new@x.example", primary: true },
    ]);
    set([{ method: "twitter", value: "@a" }]);
    upsertCreator(db, creator, t0);
    expect(read()).toHaveLength(2);
  });

  it("recovers from unreadable contacts JSON", () => {
    upsertCreator(db, { id: "UC1", name: "A", handle: "@a", stage: "new", email: null }, t0);
    db.exec("UPDATE channel_state SET contacts = 'not json'");
    upsertCreator(
      db,
      { id: "UC1", name: "A", handle: "@a", stage: "new", email: "a@x.example" },
      t0,
    );
    expect(listCreators(db)[0]?.email).toBe("a@x.example");
  });

  it("reads a legacy row (app columns NULL, no channels row) through the derived rules", () => {
    db.exec(
      `INSERT INTO channel_state (channel_id, handle, vetting_status, pipeline_stage, contacts, updated_at)
       VALUES ('UCold', '@oldtimer', 'shortlisted', 'contacted',
               '[{"method":"twitter","value":"@o"},{"method":"email","value":"first@x.example"},{"method":"email","value":"main@x.example","primary":true}]',
               '2026-10-01T09:00:00.123456+00:00'),
              ('UCrej', '@nope', 'rejected', 'new', '[]', '2026-10-01T09:00:00+00:00'),
              ('UCnew', '@fresh', 'shortlisted', 'new', 'garbage', '2026-10-01T09:00:00+00:00')`,
    );
    expect(listCreators(db)).toEqual([
      {
        id: "UCold",
        name: "@oldtimer",
        handle: "@oldtimer",
        stage: "emailed",
        email: "main@x.example",
        emailConfirmed: false,
        contactName: null,
        contactSource: null,
        contactConfidence: null,
        rejectReason: null,
        rejectedAt: null,
        neverReason: null,
        archiveDueAt: null,
        kit: null,
      },
      {
        id: "UCrej",
        name: "@nope",
        handle: "@nope",
        stage: "rejected",
        email: null,
        emailConfirmed: false,
        contactName: null,
        contactSource: null,
        contactConfidence: null,
        rejectReason: null,
        rejectedAt: null,
        neverReason: null,
        archiveDueAt: null,
        kit: null,
      },
      {
        id: "UCnew",
        name: "@fresh",
        handle: "@fresh",
        stage: "shortlisted",
        email: null,
        emailConfirmed: false,
        contactName: null,
        contactSource: null,
        contactConfidence: null,
        rejectReason: null,
        rejectedAt: null,
        neverReason: null,
        archiveDueAt: null,
        kit: null,
      },
    ]);
  });

  it("lets a known app column win and ignores an unknown one", () => {
    db.exec(
      `INSERT INTO channel_state (channel_id, handle, creator_stage, updated_at)
       VALUES ('U1', '@one', 'kit', 'x'), ('U2', '@two', 'bogus', 'x')`,
    );
    expect(listCreators(db).map((c) => c.stage)).toEqual(["kit", "new"]);
  });

  it("is STRICT about types", () => {
    expect(() => {
      db.exec(
        "INSERT INTO channel_state (channel_id, handle, updated_at, manual_engagement_rate) VALUES ('a', 'b', 'c', 'high')",
      );
    }).toThrow();
    expect(() => {
      db.exec("INSERT INTO channels (channel_id, name) VALUES ('a', x'00')");
    }).toThrow();
  });
});

describe("brands", () => {
  it("round trips and updates in place", () => {
    upsertBrand(
      db,
      { id: "b1", name: "Neuron Cloud", sells: "GPU hosting", status: "pitched" },
      t0,
    );
    upsertBrand(db, { id: "b2", name: "Notely AI", sells: "Notes app", status: "found" }, t0);
    upsertBrand(
      db,
      { id: "b1", name: "Neuron Cloud", sells: "GPU hosting", status: "won" },
      t0 + 1000,
    );
    expect(listBrands(db)).toEqual([
      { id: "b1", name: "Neuron Cloud", sells: "GPU hosting", status: "won" },
      { id: "b2", name: "Notely AI", sells: "Notes app", status: "found" },
    ]);
    expect(row("SELECT created_at, updated_at FROM brands WHERE id = 'b1'")).toMatchObject({
      created_at: "2026-10-20T10:00:00.000Z",
      updated_at: "2026-10-20T10:00:01.000Z",
    });
  });

  it("reads a legacy row (sells and status NULL) as empty and found", () => {
    db.exec(
      `INSERT INTO brands (id, name, created_at, updated_at)
       VALUES ('old', 'Old Brand', '2026-10-01T09:00:00+00:00', '2026-10-01T09:00:00+00:00')`,
    );
    expect(listBrands(db)).toEqual([{ id: "old", name: "Old Brand", sells: "", status: "found" }]);
  });

  it("is STRICT about types", () => {
    expect(() => {
      db.exec(
        "INSERT INTO brands (id, name, created_at, updated_at, budget) VALUES ('a', 'b', 'c', 'd', 'lots')",
      );
    }).toThrow();
  });
});
