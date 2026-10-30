import type { Migration } from "../migrate";

// Step P8b (B4): what Insights needs to know about deals and brands over time. `deal_events` keeps
// each step a deal reached and when; `brand_events` keeps each status a brand had and when. Triggers
// on `deals` and `brands` write them, so every write path (the app, the sync's upserts, the import)
// records the change as it lands, the same pattern as `stage_events` (0007). Both are local only:
// the sync lists don't change.

/**
 * Fills both tables backwards, where a deal or brand has no event for its current step or status
 * yet: the current value at the row's `created_at` (a row whose time can't be read is skipped), so
 * it can run again after a seed.
 */
export const backfillDealEventsSql = `
INSERT INTO deal_events (deal_id, step, at, source)
SELECT d.id, d.flow_step,
       CAST(ROUND((julianday(d.created_at) - 2440587.5) * 86400000) AS INTEGER),
       'backfill'
FROM deals d
WHERE d.flow_step IS NOT NULL
  AND julianday(d.created_at) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deal_events e WHERE e.deal_id = d.id AND e.step = d.flow_step
  );

INSERT INTO brand_events (brand_id, status, at, source)
SELECT b.id, b.status,
       CAST(ROUND((julianday(b.created_at) - 2440587.5) * 86400000) AS INTEGER),
       'backfill'
FROM brands b
WHERE b.status IS NOT NULL
  AND julianday(b.created_at) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM brand_events e WHERE e.brand_id = b.id AND e.status = b.status
  );
`;

const sql = `
CREATE TABLE deal_events (
  id INTEGER PRIMARY KEY,
  deal_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('change','backfill','example'))
) STRICT;
CREATE INDEX deal_events_deal ON deal_events (deal_id, step, at);
CREATE INDEX deal_events_step ON deal_events (step, at);

CREATE TABLE brand_events (
  id INTEGER PRIMARY KEY,
  brand_id TEXT NOT NULL,
  status TEXT NOT NULL,
  at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('change','backfill','example'))
) STRICT;
CREATE INDEX brand_events_brand ON brand_events (brand_id, status, at);
CREATE INDEX brand_events_status ON brand_events (status, at);

CREATE TRIGGER deal_events_insert AFTER INSERT ON deals
WHEN NEW.flow_step IS NOT NULL
BEGIN
  INSERT INTO deal_events (deal_id, step, at, source)
  VALUES (NEW.id, NEW.flow_step, CAST(unixepoch('subsec') * 1000 AS INTEGER), 'change');
END;

CREATE TRIGGER deal_events_update AFTER UPDATE OF flow_step ON deals
WHEN NEW.flow_step IS NOT NULL AND NEW.flow_step IS NOT OLD.flow_step
BEGIN
  INSERT INTO deal_events (deal_id, step, at, source)
  VALUES (NEW.id, NEW.flow_step, CAST(unixepoch('subsec') * 1000 AS INTEGER), 'change');
END;

CREATE TRIGGER brand_events_insert AFTER INSERT ON brands
WHEN NEW.status IS NOT NULL
BEGIN
  INSERT INTO brand_events (brand_id, status, at, source)
  VALUES (NEW.id, NEW.status, CAST(unixepoch('subsec') * 1000 AS INTEGER), 'change');
END;

CREATE TRIGGER brand_events_update AFTER UPDATE OF status ON brands
WHEN NEW.status IS NOT NULL AND NEW.status IS NOT OLD.status
BEGIN
  INSERT INTO brand_events (brand_id, status, at, source)
  VALUES (NEW.id, NEW.status, CAST(unixepoch('subsec') * 1000 AS INTEGER), 'change');
END;

${backfillDealEventsSql}
`;

export const dealEvents: Migration = { version: 9, name: "deal-events", sql };
