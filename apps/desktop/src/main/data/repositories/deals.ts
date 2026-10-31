import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { bareDeal, dealStepFrom, legacyDealStage, relationshipModels } from "@gratovo/core/data";
import type {
  Deal,
  DealCpm,
  DealHype,
  DealNegotiation,
  DealOffer,
  DealReport,
  DealShipping,
} from "@gratovo/core/data";

import {
  amountOf,
  boolList,
  clauseList,
  countOf,
  idOrNull,
  flag,
  isRecord,
  isoMs,
  isoOrNull,
  jsonOrNull,
  ms,
  num,
  oneOf,
  parseJson,
  pctOf,
  noteView,
  qcList,
  redlineList,
  strMax,
} from "./details";
import type { Row } from "./details";

/**
 * Adds a deal or updates the one with the same id. Writes the app's `flow_step` and the legacy
 * `stage` the old app reads. `now` is in ms; the table stores ISO text.
 */
export function upsertDeal(db: DatabaseSync, deal: Deal, now: number): void {
  const iso = new Date(now).toISOString();
  db.prepare(
    `INSERT INTO deals (id, brand_id, channel_id, stage, brand_price, flow_step, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       brand_id = excluded.brand_id, channel_id = excluded.channel_id, stage = excluded.stage,
       brand_price = excluded.brand_price, flow_step = excluded.flow_step,
       updated_at = excluded.updated_at`,
  ).run(
    deal.id,
    deal.brand,
    deal.creator,
    legacyDealStage(deal.step),
    deal.price,
    deal.step,
    iso,
    iso,
  );
}

/**
 * Adds a deal with every field known: the synced columns (step, price, payout, deliverable, terms,
 * invoice sent and paid, payout paid, payment reference, owner, created time) and its row in
 * `deal_details` (the rest). For the example seed. `now` is in ms; it stands in for a creation
 * time the deal does not have.
 */
export function upsertDealDetails(db: DatabaseSync, deal: Deal, now: number): void {
  const iso = new Date(now).toISOString();
  const synced: SQLInputValue[] = [
    deal.id,
    deal.brand,
    deal.creator,
    legacyDealStage(deal.step),
    deal.price ?? 0,
    deal.payout ?? 0,
    deal.deliverable,
    deal.terms,
    isoOrNull(deal.invoice.sentAt),
    isoOrNull(deal.invoice.paidAt),
    isoOrNull(deal.paidCreatorAt),
    deal.payRef,
    deal.owner,
    deal.step,
    // NOT NULL: an empty text is "not known", read back as null.
    isoOrNull(deal.createdAt) ?? "",
    iso,
  ];
  db.prepare(
    `INSERT INTO deals
       (id, brand_id, channel_id, stage, brand_price, influencer_payout, deliverables,
        payment_terms, brand_invoice_sent_at, brand_invoice_paid_at, creator_payout_paid_at,
        payment_reference, owner_id, flow_step, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       brand_id = excluded.brand_id, channel_id = excluded.channel_id, stage = excluded.stage,
       brand_price = excluded.brand_price, influencer_payout = excluded.influencer_payout,
       deliverables = excluded.deliverables, payment_terms = excluded.payment_terms,
       brand_invoice_sent_at = excluded.brand_invoice_sent_at,
       brand_invoice_paid_at = excluded.brand_invoice_paid_at,
       creator_payout_paid_at = excluded.creator_payout_paid_at,
       payment_reference = excluded.payment_reference, owner_id = excluded.owner_id,
       flow_step = excluded.flow_step, created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
  ).run(...synced);
  const detail: SQLInputValue[] = [
    deal.id,
    deal.model,
    JSON.stringify(deal.checks),
    deal.videoCount,
    deal.videosDelivered,
    deal.creatorDeadline,
    deal.goLiveAt,
    deal.dueAt,
    deal.placement,
    deal.invoice.number,
    deal.invoice.dueAt,
    jsonOrNull(deal.report),
    deal.liveUrl,
    JSON.stringify(deal.clauses),
    JSON.stringify(deal.redlines),
    jsonOrNull(deal.shipping),
    Number(deal.scriptApproved),
    JSON.stringify(deal.qc),
    jsonOrNull(deal.hype),
    deal.whitelistingUntil,
    jsonOrNull(deal.cpm),
    jsonOrNull(deal.negotiation),
    deal.notes === "" ? null : deal.notes,
  ];
  db.prepare(
    `INSERT OR REPLACE INTO deal_details
       (deal_id, model, checks, video_count, videos_delivered, creator_deadline, go_live_at,
        due_at, placement, invoice_number, invoice_due_at, report, live_url, clauses, redlines,
        shipping, script_approved, qc, hype, whitelisting_until, cpm, negotiation, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...detail);
}

/** Sets a deal's step: `flow_step` and nothing else. An unknown id is a no-op. */
export function setDealStep(db: DatabaseSync, id: string, step: number): void {
  db.prepare("UPDATE deals SET flow_step = ? WHERE id = ?").run(step, id);
}

function readReport(json: unknown): DealReport | null {
  const v = parseJson(json);
  const dueAt = isRecord(v) ? num(v["dueAt"]) : null;
  if (!isRecord(v) || dueAt === null) {
    return null;
  }
  return {
    dueAt,
    sentAt: num(v["sentAt"]),
    views: countOf(v["views"]),
    targetViews: countOf(v["targetViews"]),
    clicks: countOf(v["clicks"]),
    ctr: pctOf(v["ctr"]),
    retention: pctOf(v["retention"]),
    verdict: oneOf(["over", "under"] as const, v["verdict"]),
    makeGood: strMax(v["makeGood"]),
  };
}

function readShipping(json: unknown): DealShipping | null {
  const v = parseJson(json);
  if (!isRecord(v) || typeof v["required"] !== "boolean") {
    return null;
  }
  return {
    required: v["required"],
    item: strMax(v["item"]),
    carrier: strMax(v["carrier"]),
    tracking: strMax(v["tracking"], 100),
    shippedAt: num(v["shippedAt"]),
    deliveredAt: num(v["deliveredAt"]),
    promoCode: strMax(v["promoCode"], 60),
    utmLink: strMax(v["utmLink"]),
  };
}

function readHype(json: unknown): DealHype | null {
  const v = parseJson(json);
  return isRecord(v)
    ? {
        h24: v["h24"] === true,
        d7: v["d7"] === true,
        d14: v["d14"] === true,
        d30: v["d30"] === true,
      }
    : null;
}

function readCpm(json: unknown): DealCpm | null {
  const v = parseJson(json);
  if (!isRecord(v)) {
    return null;
  }
  const rate = amountOf(v["rate"]);
  const cap = amountOf(v["cap"]);
  const viewGuarantee = countOf(v["viewGuarantee"]);
  return rate === null || cap === null || viewGuarantee === null
    ? null
    : { rate, cap, viewGuarantee };
}

/** The most offers a negotiation keeps (the schema's limit). */
const offersMax = 50;

function readNegotiation(json: unknown): DealNegotiation | null {
  const v = parseJson(json);
  if (!isRecord(v)) {
    return null;
  }
  const ask = amountOf(v["ask"]);
  const floorPct = pctOf(v["floorPct"]);
  if (ask === null || floorPct === null) {
    return null;
  }
  const history: DealOffer[] = Array.isArray(v["history"])
    ? v["history"].flatMap((item: unknown): DealOffer[] => {
        if (!isRecord(item)) {
          return [];
        }
        const who = oneOf(["us", "brand", "creator"] as const, item["who"]);
        const amount = amountOf(item["amount"]);
        const at = num(item["at"]);
        return who === null || amount === null || at === null
          ? []
          : [{ who, amount, at, note: strMax(item["note"]) }];
      })
    : [];
  return {
    ask,
    offer: amountOf(v["offer"]),
    creatorRate: amountOf(v["creatorRate"]),
    floorPct,
    history: history.slice(0, offersMax),
  };
}

/** A synced amount: 0 is the column's "nothing yet" and, like a negative or odd one, is not known. */
function moneyOrNull(value: unknown): number | null {
  const amount = amountOf(value);
  return amount === null || amount === 0 ? null : amount;
}

function dealFromRow(row: Row, detail: Row | undefined): Deal {
  const base = bareDeal({
    id: String(row["id"]),
    brand: String(row["brand_id"]),
    creator: String(row["channel_id"]),
    step: dealStepFrom({
      flowStep: row["flow_step"] === null ? null : Number(row["flow_step"]),
      stage: String(row["stage"]),
    }),
    price: moneyOrNull(row["brand_price"]),
  });
  const synced: Deal = {
    ...base,
    payout: moneyOrNull(row["influencer_payout"]),
    owner: idOrNull(row["owner_id"]),
    createdAt: isoMs(row["created_at"]),
    deliverable: strMax(row["deliverables"]),
    terms: strMax(row["payment_terms"]),
    invoice: {
      number: null,
      sentAt: isoMs(row["brand_invoice_sent_at"]),
      dueAt: null,
      paidAt: isoMs(row["brand_invoice_paid_at"]),
    },
    paidCreatorAt: isoMs(row["creator_payout_paid_at"]),
    payRef: strMax(row["payment_reference"], 100),
    ...noteView(detail?.["notes"], row["notes"]),
  };
  if (detail === undefined) {
    return synced;
  }
  return {
    ...synced,
    model: oneOf(relationshipModels, detail["model"]),
    checks: boolList(parseJson(detail["checks"]), null).slice(0, checksMax),
    videoCount: countOf(detail["video_count"]) ?? 1,
    videosDelivered: countOf(detail["videos_delivered"]) ?? 0,
    creatorDeadline: ms(detail["creator_deadline"]),
    goLiveAt: ms(detail["go_live_at"]),
    dueAt: ms(detail["due_at"]),
    placement: strMax(detail["placement"]),
    invoice: {
      ...synced.invoice,
      number: strMax(detail["invoice_number"], 60),
      dueAt: ms(detail["invoice_due_at"]),
    },
    report: readReport(detail["report"]),
    liveUrl: strMax(detail["live_url"]),
    clauses: clauseList(parseJson(detail["clauses"])),
    redlines: redlineList(parseJson(detail["redlines"])),
    shipping: readShipping(detail["shipping"]),
    scriptApproved: flag(detail["script_approved"]) ?? false,
    qc: qcList(parseJson(detail["qc"])),
    hype: readHype(detail["hype"]),
    whitelistingUntil: ms(detail["whitelisting_until"]),
    cpm: readCpm(detail["cpm"]),
    negotiation: readNegotiation(detail["negotiation"]),
  };
}

/** The most checklist items a deal keeps (the schema's limit). */
const checksMax = 10;

/**
 * Every deal in the order added, the synced columns merged with `deal_details` (F2, F3). A deal
 * without `flow_step` gets its step from the legacy stage; one with no detail row is `bareDeal`
 * over its synced columns.
 *
 * `liveUrl` comes from the detail row only: `tracking_link` is the link the video carries, not the
 * public video.
 */
export function listDeals(db: DatabaseSync): Deal[] {
  const details = new Map<string, Row>();
  for (const row of db.prepare("SELECT * FROM deal_details").all()) {
    details.set(String(row["deal_id"]), row);
  }
  const rows = db
    .prepare(
      `SELECT id, brand_id, channel_id, stage, brand_price, flow_step, influencer_payout,
              deliverables, payment_terms, brand_invoice_sent_at, brand_invoice_paid_at,
              creator_payout_paid_at, payment_reference, owner_id, created_at, notes
       FROM deals ORDER BY rowid`,
    )
    .all();
  return rows.map((row) => dealFromRow(row, details.get(String(row["id"]))));
}

/** A deal as a viewer who does not see money gets it: no price, payout, CPM or price talk (F4). */
export function dealWithoutMoney(deal: Deal): Deal {
  return { ...deal, price: null, payout: null, cpm: null, negotiation: null };
}
