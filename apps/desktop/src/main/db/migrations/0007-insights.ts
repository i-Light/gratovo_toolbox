import type { Migration } from "../migrate";

// Step P8a: what Insights needs to know about time. `stage_events` keeps each stage a creator
// reached and when; two triggers write it, so every write path (the app, the sync's upserts, the
// import) records the change as it lands. `catalog_weeks` keeps the catalog's weekly totals, one
// row per local Monday, written by the archive sweep. Both are local only: the sync lists don't
// change.

/**
 * Fills `stage_events` backwards, where a channel has no event for that stage yet, so it can run
 * again after a seed. The log gives shortlisted, rejected and never (the earliest line of each);
 * the messages give emailed (the first email out) and replied (the first message in that is not a
 * bounce: read as one, or from a mail server's daemon address).
 */
export const backfillStageEventsSql = `
INSERT INTO stage_events (channel_id, stage, at, source)
SELECT l.entity_id,
       CASE l.action WHEN 'creator.shortlist' THEN 'shortlisted'
                     WHEN 'creator.reject' THEN 'rejected' ELSE 'never' END,
       MIN(COALESCE(l.at_ms, CAST(ROUND((julianday(l.at) - 2440587.5) * 86400000) AS INTEGER))),
       'log'
FROM activity_log l
WHERE l.entity_type = 'channel' AND l.entity_id IS NOT NULL
  AND l.action IN ('creator.shortlist', 'creator.reject', 'creator.never')
  AND NOT EXISTS (
    SELECT 1 FROM stage_events e
    WHERE e.channel_id = l.entity_id
      AND e.stage = CASE l.action WHEN 'creator.shortlist' THEN 'shortlisted'
                                  WHEN 'creator.reject' THEN 'rejected' ELSE 'never' END
  )
GROUP BY l.entity_id, l.action;

INSERT INTO stage_events (channel_id, stage, at, source)
SELECT m.channel_id, 'emailed', MIN(m.at), 'message'
FROM outreach_messages m
WHERE m.direction = 'out' AND m.kind = 'first'
  AND NOT EXISTS (
    SELECT 1 FROM stage_events e WHERE e.channel_id = m.channel_id AND e.stage = 'emailed'
  )
GROUP BY m.channel_id;

INSERT INTO stage_events (channel_id, stage, at, source)
SELECT m.channel_id, 'replied', MIN(m.at), 'message'
FROM outreach_messages m
WHERE m.direction = 'in'
  AND COALESCE(CASE WHEN json_valid(m.reading) THEN json_extract(m.reading, '$.replyType') END, '')
      <> 'any.bounce'
  AND NOT (lower(trim(COALESCE(m.peer, ''))) LIKE 'mailer-daemon@%'
        OR lower(trim(COALESCE(m.peer, ''))) LIKE 'postmaster@%')
  AND NOT EXISTS (
    SELECT 1 FROM stage_events e WHERE e.channel_id = m.channel_id AND e.stage = 'replied'
  )
GROUP BY m.channel_id;
`;

const sql = `
CREATE TABLE stage_events (
  id INTEGER PRIMARY KEY,
  channel_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('change','log','message','example'))
) STRICT;
CREATE INDEX stage_events_channel ON stage_events (channel_id, at);
CREATE INDEX stage_events_stage ON stage_events (stage, at);

CREATE TRIGGER stage_events_insert AFTER INSERT ON channel_state
WHEN NEW.creator_stage IS NOT NULL
BEGIN
  INSERT INTO stage_events (channel_id, stage, at, source)
  VALUES (NEW.channel_id, NEW.creator_stage, CAST(unixepoch('subsec') * 1000 AS INTEGER), 'change');
END;

CREATE TRIGGER stage_events_update AFTER UPDATE OF creator_stage ON channel_state
WHEN NEW.creator_stage IS NOT NULL AND NEW.creator_stage IS NOT OLD.creator_stage
BEGIN
  INSERT INTO stage_events (channel_id, stage, at, source)
  VALUES (NEW.channel_id, NEW.creator_stage, CAST(unixepoch('subsec') * 1000 AS INTEGER), 'change');
END;

CREATE TABLE catalog_weeks (
  week TEXT PRIMARY KEY,
  live INTEGER NOT NULL,
  waiting INTEGER NOT NULL,
  archive INTEGER NOT NULL,
  written_at INTEGER NOT NULL
) STRICT;

${backfillStageEventsSql}
`;

export const insights: Migration = { version: 7, name: "insights", sql };
