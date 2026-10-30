import type { Migration } from "../migrate";

// Plan step P1: what the Close and Deliver screens know beyond the synced columns. Three tables,
// local only: the sync's lists (`mirror-tables.ts`, `whole-tables.ts`) never name them. The synced
// columns stay the source for what they hold; these hold the rest. Times are ms integers; JSON in
// the TEXT columns is shaped as the core types (`work-types.ts`).

const sql = `
CREATE TABLE brand_details (
  brand_id TEXT PRIMARY KEY,
  headcount INTEGER,
  recommended_title TEXT,
  paid_spender_verified INTEGER,
  past_campaign_hook TEXT,
  budget_high REAL,
  seen TEXT NOT NULL DEFAULT '[]',
  since INTEGER,
  pitched TEXT,
  owner_id TEXT,
  status TEXT
) STRICT;

CREATE TABLE deal_details (
  deal_id TEXT PRIMARY KEY,
  model TEXT,
  checks TEXT NOT NULL DEFAULT '[]',
  video_count INTEGER NOT NULL DEFAULT 1,
  videos_delivered INTEGER NOT NULL DEFAULT 0,
  creator_deadline INTEGER,
  go_live_at INTEGER,
  due_at INTEGER,
  placement TEXT,
  invoice_number TEXT,
  invoice_due_at INTEGER,
  report TEXT,
  live_url TEXT,
  clauses TEXT NOT NULL DEFAULT '[]',
  redlines TEXT NOT NULL DEFAULT '[]',
  shipping TEXT,
  script_approved INTEGER NOT NULL DEFAULT 0,
  qc TEXT NOT NULL DEFAULT '[]',
  hype TEXT,
  whitelisting_until INTEGER,
  cpm TEXT,
  negotiation TEXT
) STRICT;

CREATE TABLE creator_details (
  channel_id TEXT PRIMARY KEY,
  owner_id TEXT,
  relationship TEXT,
  last_update_at INTEGER,
  locks TEXT NOT NULL DEFAULT '[]',
  next_open_slot INTEGER,
  onboarding TEXT,
  format TEXT,
  bot_risk TEXT,
  bot_note TEXT,
  socials TEXT NOT NULL DEFAULT '{}'
) STRICT;
`;

export const details: Migration = { version: 8, name: "details", sql };
