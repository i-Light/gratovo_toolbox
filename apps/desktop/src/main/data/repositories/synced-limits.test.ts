import type { DatabaseSync } from "node:sqlite";

import { frameSchema } from "@gratovo/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";
import { createSqliteSource } from "../sqlite-source";
import type { FrameExtras } from "../sqlite-source";

import { listBrands, setBrand } from "./brands";
import { listDeals } from "./deals";

/** F10: odd values the legacy app or the sync wrote must never stop the frame from loading. */

const extras: FrameExtras = {
  presence: () => ({ status: "away", doing: "" }),
  counts: () => ({ today: 0, plannedMinutes: 0, find: 0, reach: 0, close: 0, deliver: 0 }),
  mateRun: () => null,
};

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => {
  db.close();
});

const long = (n: number) => "x".repeat(n);

function writeOddRows(): void {
  const brand = db.prepare(
    `INSERT INTO brands (id, name, sells, status, category, country, website, contacts, budget, contact_name, contact_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'x', 'x')`,
  );
  const contacts = JSON.stringify(
    Array.from({ length: 9 }, (_, i) => ({
      name: long(900),
      title: long(900),
      email: long(900),
      isPrimary: i === 7,
    })),
  );
  brand.run(
    "b1",
    long(900),
    long(900),
    "pitched",
    long(80),
    "usa",
    long(900),
    contacts,
    -5,
    null,
    null,
  );
  brand.run(
    "b2",
    "Plain",
    null,
    "found",
    "code",
    " gb ",
    null,
    "[]",
    Infinity,
    "Sam",
    "s@x.example",
  );
  db.prepare(
    `INSERT INTO brand_details (brand_id, headcount, recommended_title, past_campaign_hook, budget_high, seen, owner_id)
     VALUES ('b1', -3, ?, ?, -1, ?, ?)`,
  ).run(
    long(900),
    long(900),
    JSON.stringify([long(150), ...Array.from({ length: 300 }, (_, i) => `UC${String(i)}`)]),
    long(150),
  );
  db.prepare(
    `INSERT INTO deals (id, brand_id, channel_id, stage, brand_price, influencer_payout, deliverables, payment_terms, payment_reference, owner_id, created_at, updated_at)
     VALUES ('d1', 'b1', 'UCa', 'agreed', -100, -1, ?, ?, ?, ?, 'x', 'x'),
            ('d2', 'b1', 'UCa', 'agreed', 0, 0, null, null, null, null, 'x', 'x')`,
  ).run(long(900), long(900), long(300), long(300));
  db.prepare(
    `INSERT INTO deal_details (deal_id, placement, invoice_number, video_count, checks, live_url, cpm, negotiation)
     VALUES ('d1', ?, ?, -2, ?, ?, '{"rate":-1,"cap":5,"viewGuarantee":1.5}', '{"ask":10,"floorPct":300,"history":[]}')`,
  ).run(long(900), long(200), JSON.stringify(Array(30).fill(true)), long(900));
  db.prepare(
    `INSERT INTO creator_details (channel_id, owner_id, locks, onboarding, bot_risk, bot_note, socials)
     VALUES ('UCa', ?, ?, ?, 'low', ?, ?)`,
  ).run(
    long(300),
    JSON.stringify(
      Array.from({ length: 40 }, () => ({ category: long(90), brand: long(900), until: 1 })),
    ),
    JSON.stringify({ dreamBrands: Array(50).fill(long(900)), hardNos: [], paymentRail: long(900) }),
    long(900),
    JSON.stringify({ [long(40)]: "x", yt: long(300) }),
  );
  db.prepare(
    `INSERT INTO channel_state (channel_id, handle, vetting_status, pipeline_stage, contacts, updated_at)
     VALUES ('UCa', '@a', 'newlyFound', 'new', '[]', 'x')`,
  ).run();
}

describe("synced values over the schema's limits", () => {
  it("still gives a frame the schema accepts", async () => {
    writeOddRows();
    const source = createSqliteSource(db, { source: "live", me: "u1", extras });
    const parsed = frameSchema.safeParse(await source.frame());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("cleans a brand", () => {
    writeOddRows();
    const [b1, b2] = listBrands(db);
    expect(b1).toMatchObject({ country: null, category: null, budget: null, budgetKnown: false });
    expect(b1?.name).toHaveLength(500);
    expect(b1?.contacts).toHaveLength(4);
    // The legacy primary goes first.
    expect(b1?.contacts[0]?.name).toHaveLength(500);
    expect(b1?.seen).toHaveLength(200);
    expect(b1?.headcount).toBeNull();
    expect(b1?.owner).toBeNull();
    expect(b2).toMatchObject({
      country: "GB",
      budget: null,
      contacts: [{ name: "Sam", role: null, email: "s@x.example" }],
    });
  });

  it("puts the primary contact first", () => {
    db.prepare(
      `INSERT INTO brands (id, name, contacts, created_at, updated_at)
       VALUES ('b', 'B', '[{"name":"One"},{"name":"Two","primary":true}]', 'x', 'x')`,
    ).run();
    expect(listBrands(db)[0]?.contacts.map((c) => c.name)).toEqual(["Two", "One"]);
  });

  it("reads a price of 0 or below as not known", () => {
    writeOddRows();
    for (const deal of listDeals(db)) {
      expect(deal.price).toBeNull();
      expect(deal.payout).toBeNull();
    }
  });

  it("lets brands.status win over a stale detail status", () => {
    db.prepare(
      "INSERT INTO brands (id, name, status, created_at, updated_at) VALUES ('b', 'B', 'won', 'x', 'x')",
    ).run();
    db.prepare("INSERT INTO brand_details (brand_id, status) VALUES ('b', 'pitched')").run();
    expect(listBrands(db)[0]?.status).toBe("won");
    db.prepare("UPDATE brands SET status = 'bogus'").run();
    expect(listBrands(db)[0]?.status).toBe("pitched");
    setBrand(db, { id: "b", name: "B", sells: "", status: "lost" }, 0);
    expect(listBrands(db)[0]?.status).toBe("lost");
  });
});
