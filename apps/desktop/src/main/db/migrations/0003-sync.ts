import type { Migration } from "../migrate";

// Step 3d-2b: the sync engine's local tables. `_outbox` holds changes not yet sent, one row per
// intent, in the order they were made; `_outbox_dropped` keeps what the server refused.
// `edit_conflicts` mirrors your open conflicts. `activity_log` gains `at_ms` (the line's time as a
// number, so lines written with `Z` and with `+00:00` sort together) and `received_at` (the
// server's receive time, the pull cursor). `notifications.money` marks a notification that
// mentions money.
const sql = `
CREATE TABLE _outbox (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  target_table TEXT,
  target_key   TEXT,
  created_at   TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_code    TEXT
) STRICT;

CREATE INDEX idx_outbox_target ON _outbox (target_table, target_key);
CREATE INDEX idx_outbox_user ON _outbox (user_id, seq);

CREATE TABLE _outbox_dropped (
  seq        INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  code       TEXT NOT NULL,
  dropped_at TEXT NOT NULL
) STRICT;

CREATE TABLE edit_conflicts (
  id                TEXT PRIMARY KEY,
  channel_id        TEXT NOT NULL,
  channel_label     TEXT NOT NULL,
  field             TEXT NOT NULL,
  base_value        TEXT,
  mine_value        TEXT,
  theirs_value      TEXT,
  mine_actor_id     TEXT,
  mine_actor_name   TEXT NOT NULL,
  theirs_actor_name TEXT,
  detected_at       TEXT,
  resolved_at       TEXT,
  updated_at        TEXT,
  resolved_locally  INTEGER NOT NULL DEFAULT 0
) STRICT;

ALTER TABLE activity_log ADD COLUMN at_ms INTEGER;
ALTER TABLE activity_log ADD COLUMN received_at TEXT;
UPDATE activity_log SET at_ms = CAST(ROUND((julianday(at) - 2440587.5) * 86400000) AS INTEGER);
CREATE INDEX idx_activity_log_at_ms ON activity_log (at_ms DESC, id DESC);
CREATE INDEX idx_activity_log_entity ON activity_log (entity_type, entity_id);

ALTER TABLE notifications ADD COLUMN money INTEGER NOT NULL DEFAULT 0;
`;

export const sync: Migration = { version: 3, name: "sync", sql };
