import type { Migration } from "../migrate";

// Mirror tables carry every remote column of the Supabase table (see
// legacy/lib/core/sync/mirror_tables.dart), so 3d-2's pull needs no migration
// for them. Timestamps are ISO 8601 text as the server sends them; uuid, jsonb
// and arrays are TEXT (JSON for jsonb and arrays). No foreign keys: the server
// owns integrity, and pages and tombstones arrive in any order.
const sql = `
CREATE TABLE profiles (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  color        TEXT NOT NULL DEFAULT '#3B82F6',
  role         TEXT NOT NULL DEFAULT 'unauthorized',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;

CREATE TABLE channel_state (
  channel_id                   TEXT PRIMARY KEY,
  handle                       TEXT NOT NULL,
  vetting_status               TEXT NOT NULL DEFAULT 'newlyFound',
  relevance_criteria           TEXT,
  notes                        TEXT,
  pipeline_stage               TEXT NOT NULL DEFAULT 'new',
  channel_tags                 TEXT NOT NULL DEFAULT '[]',
  contacts                     TEXT NOT NULL DEFAULT '[]',
  provided_data                TEXT,
  archive_due_at               TEXT,
  last_deal_at                 TEXT,
  last_edited_by               TEXT,
  last_edited_by_name          TEXT,
  updated_at                   TEXT NOT NULL,
  owner_id                     TEXT,
  manual_engagement_rate       REAL,
  manual_engagement_note       TEXT,
  manual_engagement_updated_at TEXT,
  media_kit                    TEXT,
  creator_gender               TEXT,
  creator_stage                TEXT -- no Supabase column yet: 3d-2 Q2-Q4
) STRICT;

CREATE TABLE brands (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  contact_name       TEXT,
  contact_email      TEXT,
  contact_phone      TEXT,
  website            TEXT,
  budget             REAL,
  campaign_brief     TEXT,
  preferred_criteria TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  category           TEXT,
  country            TEXT,
  contacts           TEXT NOT NULL DEFAULT '[]',
  budget_currency    TEXT NOT NULL DEFAULT 'USD',
  source             TEXT,
  sells              TEXT, -- no Supabase column yet: 3d-2 Q2-Q4
  status             TEXT  -- no Supabase column yet: 3d-2 Q2-Q4
) STRICT;

CREATE TABLE deals (
  id                      TEXT PRIMARY KEY,
  brand_id                TEXT NOT NULL,
  channel_id              TEXT NOT NULL,
  stage                   TEXT NOT NULL DEFAULT 'proposed',
  brand_price             REAL NOT NULL DEFAULT 0,
  influencer_payout       REAL NOT NULL DEFAULT 0,
  deliverables            TEXT,
  deadline                TEXT,
  contract_url            TEXT,
  notes                   TEXT,
  working_days_estimate   INTEGER,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  campaign_id             TEXT,
  owner_id                TEXT,
  currency                TEXT NOT NULL DEFAULT 'USD',
  brand_invoice_sent_at   TEXT,
  brand_invoice_paid_at   TEXT,
  creator_payout_due_at   TEXT,
  creator_payout_paid_at  TEXT,
  payment_method          TEXT,
  payment_reference       TEXT,
  payment_terms           TEXT,
  tracking_link           TEXT,
  creator_contract_url    TEXT,
  creator_contract_status TEXT NOT NULL DEFAULT 'none',
  creator_signed_at       TEXT,
  brand_contract_url      TEXT,
  brand_contract_status   TEXT NOT NULL DEFAULT 'none',
  brand_signed_at         TEXT,
  flow_step               INTEGER -- no Supabase column yet: 3d-2 Q2-Q4
) STRICT;

CREATE TABLE activity_log (
  id           TEXT PRIMARY KEY,
  at           TEXT NOT NULL,
  actor_id     TEXT,
  actor_name   TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  entity_label TEXT,
  field        TEXT,
  old_value    TEXT,
  new_value    TEXT,
  detail       TEXT
) STRICT;

-- Local-only tables.
CREATE TABLE channels (
  channel_id TEXT PRIMARY KEY,
  name       TEXT NOT NULL
) STRICT;

CREATE TABLE notifications (
  id        TEXT PRIMARY KEY,
  at        INTEGER NOT NULL,
  icon      TEXT NOT NULL,
  text      TEXT NOT NULL,
  sub       TEXT NOT NULL,
  go_screen TEXT NOT NULL,
  go_tab    TEXT,
  read      INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE local_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE INDEX idx_activity_log_at ON activity_log (at DESC, id DESC);
CREATE INDEX idx_notifications_at ON notifications (at DESC);
CREATE INDEX idx_deals_brand ON deals (brand_id);
CREATE INDEX idx_deals_channel ON deals (channel_id);
`;

export const initial: Migration = { version: 1, name: "initial", sql };
