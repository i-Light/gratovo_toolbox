import {
  botRiskLevels,
  brandContactsMax,
  brandStatuses,
  contractClauses,
  creatorFormats,
  qcChecks,
  redlineClauses,
  relationshipModels,
  type Brand,
  type CreatorDetails,
  type Deal,
} from "@gratovo/core/data";
import { z } from "zod";

/**
 * The schemas of the full brand, deal and creator-details shapes (plan step P1), typed against
 * the core types. Objects are strict; free text is capped; nothing here is a path or a secret.
 */

const idMax = 100;
const textMax = 500;
/** The most creators a brand lists as seen, or a pitch names. */
const refsMax = 200;
/** The most offers a negotiation keeps. */
const offersMax = 50;
/** The most exclusivity locks or onboarding entries on one creator. */
const entriesMax = 30;
/** The most checklist items a deal step has (DEAL_FLOW's longest is 4). */
const checksMax = 10;

const id = z.string().min(1).max(idMax);
const text = z.string().max(textMax);
const time = z.number();
const count = z.number().int().nonnegative();
const amount = z.number().nonnegative();
const pct = z.number().min(0).max(100);

const brandContactSchema = z.strictObject({
  name: text,
  role: text.nullable(),
  email: text.nullable(),
});

export const brandSchema: z.ZodType<Brand> = z.strictObject({
  id,
  name: text,
  sells: text,
  status: z.enum(brandStatuses),
  category: z.string().max(40).nullable(),
  country: z.string().max(3).nullable(),
  site: text.nullable(),
  headcount: count.nullable(),
  recommendedTitle: text.nullable(),
  paidSpenderVerified: z.boolean().nullable(),
  pastCampaignHook: text.nullable(),
  // Null when the member may not see money: the main process strips it before the frame leaves.
  budget: z.strictObject({ low: amount, high: amount }).nullable(),
  budgetKnown: z.boolean(),
  contacts: z.array(brandContactSchema).max(brandContactsMax),
  seen: z.array(id).max(refsMax),
  since: time.nullable(),
  pitched: z
    .strictObject({
      at: time,
      creators: z.array(id).max(refsMax),
      mode: z.enum(["cold", "warm"]),
    })
    .nullable(),
  owner: id.nullable(),
});

const offerSchema = z.strictObject({
  who: z.enum(["us", "brand", "creator"]),
  amount,
  at: time,
  note: text.nullable(),
});

export const dealSchema: z.ZodType<Deal> = z.strictObject({
  id,
  brand: id,
  creator: id,
  step: count,
  // Money is null when the member may not see it: the main process strips it.
  price: amount.nullable(),
  payout: amount.nullable(),
  model: z.enum(relationshipModels).nullable(),
  owner: id.nullable(),
  checks: z.array(z.boolean()).max(checksMax),
  videoCount: count,
  videosDelivered: count,
  createdAt: time.nullable(),
  creatorDeadline: time.nullable(),
  goLiveAt: time.nullable(),
  dueAt: time.nullable(),
  deliverable: text.nullable(),
  terms: text.nullable(),
  placement: text.nullable(),
  invoice: z.strictObject({
    number: z.string().max(60).nullable(),
    sentAt: time.nullable(),
    dueAt: time.nullable(),
    paidAt: time.nullable(),
  }),
  report: z
    .strictObject({
      dueAt: time,
      sentAt: time.nullable(),
      views: count.nullable(),
      targetViews: count.nullable(),
      clicks: count.nullable(),
      ctr: pct.nullable(),
      retention: pct.nullable(),
      verdict: z.enum(["over", "under"]).nullable(),
      makeGood: text.nullable(),
    })
    .nullable(),
  paidCreatorAt: time.nullable(),
  payRef: z.string().max(100).nullable(),
  liveUrl: text.nullable(),
  clauses: z.array(z.boolean()).length(contractClauses.length),
  redlines: z.array(z.enum(redlineClauses)).max(redlineClauses.length),
  shipping: z
    .strictObject({
      required: z.boolean(),
      item: text.nullable(),
      carrier: text.nullable(),
      tracking: z.string().max(100).nullable(),
      shippedAt: time.nullable(),
      deliveredAt: time.nullable(),
      promoCode: z.string().max(60).nullable(),
      utmLink: text.nullable(),
    })
    .nullable(),
  scriptApproved: z.boolean(),
  qc: z.array(z.boolean()).length(qcChecks.length),
  hype: z
    .strictObject({ h24: z.boolean(), d7: z.boolean(), d14: z.boolean(), d30: z.boolean() })
    .nullable(),
  whitelistingUntil: time.nullable(),
  cpm: z.strictObject({ rate: amount, cap: amount, viewGuarantee: count }).nullable(),
  negotiation: z
    .strictObject({
      ask: amount,
      offer: amount.nullable(),
      creatorRate: amount.nullable(),
      floorPct: pct,
      history: z.array(offerSchema).max(offersMax),
    })
    .nullable(),
});

export const creatorDetailsSchema: z.ZodType<CreatorDetails, CreatorDetails> = z.strictObject({
  owner: id.nullable(),
  relationship: z.enum(relationshipModels).nullable(),
  lastUpdateAt: time.nullable(),
  locks: z
    .array(z.strictObject({ category: z.string().max(40), brand: text, until: time }))
    .max(entriesMax),
  nextOpenSlot: time.nullable(),
  onboarding: z
    .strictObject({
      dreamBrands: z.array(text).max(entriesMax),
      hardNos: z.array(text).max(entriesMax),
      paymentRail: text.nullable(),
      taxForm: text.nullable(),
    })
    .nullable(),
  format: z.enum(creatorFormats).nullable(),
  botRisk: z.strictObject({ level: z.enum(botRiskLevels), note: text.nullable() }).nullable(),
  socials: z.record(z.string().max(20), z.string().max(100)),
});
