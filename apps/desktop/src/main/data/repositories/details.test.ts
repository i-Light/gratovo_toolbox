import type { DatabaseSync } from "node:sqlite";

import { bareBrand, bareDeal, noDetails } from "@gratovo/core/data";
import type { Brand, CreatorDetails, Deal } from "@gratovo/core/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../db/open-database";

import { brandWithoutMoney, listBrands, setBrand, upsertBrandDetails } from "./brands";
import { creatorStates, listCreators } from "./creators";
import { dealWithoutMoney, listDeals, upsertDealDetails } from "./deals";
import { upsertCreatorDetails, writeNotes } from "./details";

const t0 = Date.UTC(2026, 9, 20, 10, 0, 0);

let db: DatabaseSync;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => {
  db.close();
});

const fullBrand: Brand = {
  ...bareBrand({ id: "b1", name: "Neuron Cloud", sells: "GPU hosting", status: "lost" }),
  category: "code",
  country: "US",
  site: "neuron.example",
  headcount: 80,
  recommendedTitle: "Head of Partnerships",
  paidSpenderVerified: true,
  pastCampaignHook: "Their launch with two coding channels",
  budget: { low: 2000, high: 5000 },
  budgetKnown: true,
  contacts: [{ name: "Ada Wu", role: "Partnerships", email: "ada@neuron.example" }],
  seen: ["UCa"],
  since: t0 - 1000,
  pitched: { at: t0, creators: ["UCa", "UCb"], mode: "warm" },
  owner: "m1",
};

const fullDeal: Deal = {
  ...bareDeal({ id: "d1", brand: "b1", creator: "UCa", step: 6, price: 4500 }),
  payout: 3000,
  model: "brokered",
  owner: "m1",
  checks: [true, false],
  videoCount: 3,
  videosDelivered: 1,
  createdAt: t0 - 5000,
  creatorDeadline: t0 + 1,
  goLiveAt: t0 + 2,
  dueAt: t0 + 3,
  deliverable: "60 s integration",
  terms: "Net 30",
  placement: "First third",
  invoice: { number: "GR-1", sentAt: t0 + 4, dueAt: t0 + 5, paidAt: t0 + 6 },
  report: {
    dueAt: t0 + 7,
    sentAt: null,
    views: 1000,
    targetViews: 2000,
    clicks: 50,
    ctr: 5,
    retention: 40,
    verdict: "under",
    makeGood: "A second integration",
  },
  paidCreatorAt: t0 + 8,
  payRef: "WISE-1",
  liveUrl: "youtu.be/x",
  clauses: [true, true, true, false, true, true, true],
  redlines: ["net60"],
  shipping: {
    required: true,
    item: "Dev kit",
    carrier: "DHL",
    tracking: "T1",
    shippedAt: t0,
    deliveredAt: null,
    promoCode: "AI10",
    utmLink: "neuron.example/?utm=1",
  },
  scriptApproved: true,
  qc: [true, true, false, false, true],
  hype: { h24: true, d7: false, d14: false, d30: false },
  whitelistingUntil: t0 + 9,
  cpm: { rate: 40, cap: 6000, viewGuarantee: 100000 },
  negotiation: {
    ask: 5000,
    offer: 4500,
    creatorRate: 3000,
    floorPct: 25,
    history: [{ who: "brand", amount: 4500, at: t0, note: null }],
  },
};

describe("brands with details", () => {
  it("reads a brand with no detail row as bareBrand over its synced columns", () => {
    db.exec(
      `INSERT INTO brands (id, name, sells, status, category, country, website, budget, contacts, created_at, updated_at)
       VALUES ('b1', 'Notely AI', 'Notes', 'pitched', 'voice', 'GB', 'notely.example', 1500,
               '[{"name":"Sam","title":"CMO","email":"s@notely.example"}]', 'x', 'x')`,
    );
    expect(listBrands(db)).toEqual([
      {
        ...bareBrand({ id: "b1", name: "Notely AI", sells: "Notes", status: "pitched" }),
        category: "voice",
        country: "GB",
        site: "notely.example",
        budget: { low: 1500, high: 1500 },
        budgetKnown: true,
        contacts: [{ name: "Sam", role: "CMO", email: "s@notely.example" }],
      },
    ]);
  });

  it("round trips a full brand, with the status from the detail row", () => {
    upsertBrandDetails(db, fullBrand, t0);
    expect(listBrands(db)).toEqual([fullBrand]);
    // brand.set changes the synced status and the kept one follows it.
    setBrand(db, { id: "b1", name: "Neuron Cloud", sells: "GPU hosting", status: "won" }, t0);
    expect(listBrands(db)[0]?.status).toBe("won");
  });

  it("reads bad JSON and unknown values as not known, without throwing", () => {
    upsertBrandDetails(db, fullBrand, t0);
    db.exec(
      `UPDATE brands SET status = 'active', contacts = 'not json';
       UPDATE brand_details SET seen = '{{', pitched = '"x"', status = 'bogus'`,
    );
    const [brand] = listBrands(db);
    expect(brand).toMatchObject({ status: "found", contacts: [], seen: [], pitched: null });
  });

  it("strips the budget for a viewer without money, and keeps budgetKnown", () => {
    expect(brandWithoutMoney(fullBrand)).toEqual({ ...fullBrand, budget: null });
    expect(brandWithoutMoney(fullBrand).budgetKnown).toBe(true);
  });
});

describe("deals with details", () => {
  it("reads a deal with no detail row as bareDeal over its synced columns", () => {
    db.exec(
      `INSERT INTO deals (id, brand_id, channel_id, stage, brand_price, flow_step, deliverables,
                          payment_terms, brand_invoice_sent_at, owner_id, created_at, updated_at)
       VALUES ('d1', 'b1', 'UCa', 'live', 4500, 6, 'A video', 'Net 30', '2026-10-20T10:00:00.000Z',
               'm1', '2026-10-01T00:00:00.000Z', 'x')`,
    );
    expect(listDeals(db)).toEqual([
      {
        ...bareDeal({ id: "d1", brand: "b1", creator: "UCa", step: 6, price: 4500 }),
        owner: "m1",
        createdAt: Date.UTC(2026, 9, 1),
        deliverable: "A video",
        terms: "Net 30",
        invoice: { number: null, sentAt: t0, dueAt: null, paidAt: null },
      },
    ]);
  });

  it("round trips a full deal", () => {
    upsertDealDetails(db, fullDeal, t0);
    expect(listDeals(db)).toEqual([fullDeal]);
  });

  it("reads bad JSON and unknown values as not known, without throwing", () => {
    upsertDealDetails(db, fullDeal, t0);
    db.exec(
      `UPDATE deal_details SET model = 'bogus', checks = 'oops', clauses = '5',
         redlines = '["net60","x"]', report = '[', shipping = '1', hype = 'x',
         cpm = '{"rate":"a"}', negotiation = '{', qc = '{}'`,
    );
    const [deal] = listDeals(db);
    expect(deal).toMatchObject({
      model: null,
      checks: [],
      clauses: [false, false, false, false, false, false, false],
      redlines: ["net60"],
      report: null,
      shipping: null,
      hype: null,
      cpm: null,
      negotiation: null,
      qc: [false, false, false, false, false],
    });
  });

  it("strips price, payout, CPM and the price talk, keeping the rest", () => {
    expect(dealWithoutMoney(fullDeal)).toEqual({
      ...fullDeal,
      price: null,
      payout: null,
      cpm: null,
      negotiation: null,
    });
  });
});

describe("creator details", () => {
  const details: CreatorDetails = {
    owner: "m1",
    relationship: "exclusive_25",
    lastUpdateAt: t0,
    locks: [{ category: "code", brand: "Neuron Cloud", until: t0 + 1 }],
    nextOpenSlot: t0 + 2,
    onboarding: {
      dreamBrands: ["Notely AI"],
      hardNos: ["Crypto"],
      paymentRail: "Wise",
      taxForm: null,
    },
    format: "talking_head",
    botRisk: { level: "watch", note: "Spiky first day" },
    socials: { x: "@aidaily" },
  };

  it("leaves out details for a creator with no row, and reads a full row", () => {
    db.exec(
      `INSERT INTO channel_state (channel_id, handle, creator_stage, updated_at)
       VALUES ('UCa', '@a', 'new', 'x'), ('UCb', '@b', 'new', 'x')`,
    );
    upsertCreatorDetails(db, "UCa", details);
    const list = listCreators(db);
    expect(list[0]?.details).toEqual(details);
    expect(list[1]).not.toHaveProperty("details");
    const states = creatorStates(db);
    expect(states[0]?.details).toEqual(details);
    expect(states[1]).not.toHaveProperty("details");
  });

  it("reads bad JSON and unknown values as not known", () => {
    db.exec(
      `INSERT INTO channel_state (channel_id, handle, creator_stage, updated_at)
       VALUES ('UCa', '@a', 'new', 'x')`,
    );
    upsertCreatorDetails(db, "UCa", details);
    db.exec(
      `UPDATE creator_details SET relationship = 'x', format = 'y', bot_risk = 'z', locks = '[',
         onboarding = '1', socials = '[]'`,
    );
    expect(listCreators(db)[0]?.details).toEqual({
      ...noDetails,
      owner: "m1",
      lastUpdateAt: t0,
      nextOpenSlot: t0 + 2,
    });
  });
});

describe("notes on brands and deals (R7)", () => {
  function seed(): void {
    db.exec(
      `INSERT INTO brands (id, name, notes, created_at, updated_at) VALUES ('b1', 'Notely AI', 'Synced note', 'x', 'x');
       INSERT INTO deals (id, brand_id, channel_id, flow_step, notes, created_at, updated_at)
       VALUES ('d1', 'b1', 'UCa', 2, NULL, 'x', 'x')`,
    );
  }
  const brandNote = () => listBrands(db)[0];
  const dealNote = () => listDeals(db)[0];
  const outbox = () => Number(db.prepare("SELECT COUNT(*) AS c FROM _outbox").get()?.["c"]);

  it("reads the synced note, then the local note over it", () => {
    seed();
    expect(brandNote()).toMatchObject({ notes: "Synced note", notesCut: false });
    expect(dealNote()).toMatchObject({ notes: "", notesCut: false });
    expect(writeNotes(db, "brand", { id: "b1", base: "Synced note", notes: "Mine" })).toBe(true);
    expect(brandNote()?.notes).toBe("Mine");
    // The synced column is untouched, and nothing waits to be sent.
    expect(db.prepare("SELECT notes FROM brands").get()).toEqual({ notes: "Synced note" });
    expect(outbox()).toBe(0);
  });

  it("creates the details row for a deal and keeps the other detail columns", () => {
    seed();
    expect(writeNotes(db, "deal", { id: "d1", base: "", notes: "Check the go-live date." })).toBe(
      true,
    );
    expect(dealNote()).toMatchObject({ notes: "Check the go-live date.", videoCount: 1 });
    expect(db.prepare("SELECT COUNT(*) AS c FROM deal_details").get()).toEqual({ c: 1 });
  });

  it("clears the note with empty text, and the synced text does not come back", () => {
    seed();
    writeNotes(db, "brand", { id: "b1", base: "Synced note", notes: "" });
    expect(brandNote()?.notes).toBe("");
  });

  it("keeps the newest save even from an older base, and skips an unknown id", () => {
    seed();
    expect(writeNotes(db, "brand", { id: "b1", base: "Older text", notes: "Mine" })).toBe(true);
    expect(brandNote()?.notes).toBe("Mine");
    expect(writeNotes(db, "brand", { id: "nope", base: "", notes: "Mine" })).toBe(false);
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM brand_details WHERE brand_id = 'nope'").get(),
    ).toEqual({ c: 0 });
  });

  it("returns a note over the limit cut, with notesCut set", () => {
    seed();
    db.prepare("UPDATE deals SET notes = ? WHERE id = 'd1'").run("x".repeat(50_001));
    const deal = dealNote();
    expect(deal?.notes).toHaveLength(50_000);
    expect(deal?.notesCut).toBe(true);
  });

  it("round trips the seed's notes through the detail rows", () => {
    upsertBrandDetails(db, { ...fullBrand, notes: "Asks for a demo first." }, t0);
    upsertDealDetails(db, { ...fullDeal, notes: "One round of changes." }, t0);
    expect(listBrands(db)[0]?.notes).toBe("Asks for a demo first.");
    expect(listDeals(db)[0]?.notes).toBe("One round of changes.");
  });
});
