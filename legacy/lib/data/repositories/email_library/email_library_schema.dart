import 'package:gratovo_toolbox/core/local_db/local_db.dart';

/// The Email Critique Library's SQLite schema, as an append-only migration list.
///
/// **Never edit an element of [_migrations] that has shipped.** This file is
/// the only copy of the corpus — see [LocalDbSpec] for the full rule. A change
/// is a new string on the end, and the opener runs whichever ones a given
/// machine has not run yet.
///
/// Every timestamp column is an ISO-8601 UTC string rather than an epoch
/// number, and `video_date` is a bare `YYYY-MM-DD`. Both so that
/// `pipeline/tools/email_library.py` — and anyone who opens the file in a
/// SQLite browser — reads dates without needing this file to interpret them.
const emailLibrarySpec = LocalDbSpec(
  fileName: 'email_library.db',
  migrations: _migrations,
);

const _migrations = <String>[_v1, _v2, _v3, _v4, _v5, _v6];

/// v1 — records, the two tag vocabularies, and the sticky per-audience
/// defaults.
///
/// `label_key` alongside `label` rather than a `lower(label)` expression index:
/// the same uniqueness has to hold when Python writes to this file, and a
/// plain column is a rule every client can see, where an expression index is
/// one only SQLite enforces.
const _v1 = '''
CREATE TABLE IF NOT EXISTS email_tags (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  label       TEXT NOT NULL,
  label_key   TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE (kind, label_key)
);

CREATE TABLE IF NOT EXISTS email_records (
  id                TEXT PRIMARY KEY,
  audience          TEXT NOT NULL,
  video_date        TEXT,
  video_url         TEXT NOT NULL DEFAULT '',
  timecode_seconds  INTEGER,
  context           TEXT NOT NULL DEFAULT '',
  subject           TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',
  critique          TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS email_records_audience
  ON email_records (audience, updated_at DESC);

CREATE TABLE IF NOT EXISTS email_record_tags (
  record_id  TEXT NOT NULL REFERENCES email_records (id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES email_tags (id)    ON DELETE CASCADE,
  PRIMARY KEY (record_id, tag_id)
);

CREATE INDEX IF NOT EXISTS email_record_tags_tag
  ON email_record_tags (tag_id);

CREATE TABLE IF NOT EXISTS email_draft_defaults (
  audience    TEXT PRIMARY KEY,
  video_date  TEXT,
  video_url   TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL
);

-- The three stages the outreach sequence actually has, seeded so the tag row
-- is useful on first open. `sort_order` holds sequence order, not alphabetical
-- order: a follow-up comes after a cold open in the work and should read that
-- way in the control. Fixed ids so a record tagged on one machine means the
-- same thing on another, and so re-running this is a no-op.
INSERT OR IGNORE INTO email_tags (id, kind, label, label_key, sort_order, created_at)
VALUES
  ('stage-initial',   'stage', 'Initial cold outreach', 'initial cold outreach', 0, '1970-01-01T00:00:00.000Z'),
  ('stage-follow-up', 'stage', 'Follow-up',             'follow-up',             1, '1970-01-01T00:00:00.000Z'),
  ('stage-closing',   'stage', 'Closing',               'closing',               2, '1970-01-01T00:00:00.000Z');
''';

/// v2 — the `@` placeholder vocabulary the email body's mention menu offers.
///
/// Seeded rather than hard-coded in the widget so the list is editable: the
/// menu's "+" writes here, and a keyword added on one machine is in the file
/// the next person opens. Fixed ids for the same reason the stage tags have
/// them, and `INSERT OR IGNORE` so re-running this cannot disturb a library
/// where one of them has since been renamed.
const _v2 = '''
INSERT OR IGNORE INTO email_tags (id, kind, label, label_key, sort_order, created_at)
VALUES
  ('placeholder-receiver', 'placeholder', 'receiver', 'receiver', 0, '1970-01-01T00:00:00.000Z'),
  ('placeholder-sender',   'placeholder', 'sender',   'sender',   1, '1970-01-01T00:00:00.000Z'),
  ('placeholder-creator',  'placeholder', 'creator',  'creator',  2, '1970-01-01T00:00:00.000Z'),
  ('placeholder-brand',    'placeholder', 'brand',    'brand',    3, '1970-01-01T00:00:00.000Z'),
  ('placeholder-product',  'placeholder', 'product',  'product',  4, '1970-01-01T00:00:00.000Z');
''';

/// v3 — the stage tag joins the sticky per-audience defaults, so a run of
/// records typed from one video keeps its place in the sequence without the
/// stage being re-picked every time.
///
/// Stored as a comma-separated id list in one column rather than its own
/// table: it is a short list of opaque ids that is only ever read or written
/// whole, and a plain string is one fewer join for anything — the Python
/// pipeline included — that reads this file.
const _v3 = '''
ALTER TABLE email_draft_defaults
  ADD COLUMN stage_tag_ids TEXT NOT NULL DEFAULT '';
''';

/// v4 — the timecode joins them.
///
/// A run of emails is read off one video in one pass, so the next timecode is
/// always a little further into the same recording than the last. Starting
/// from where the previous record left off means spinning the seconds forward
/// rather than entering the position from zero every time.
///
/// Nullable with no default, unlike the columns above: "no timecode recorded"
/// is a real state for this field, and `0` is a real position in a video, so
/// the two cannot share a representation.
const _v4 = '''
ALTER TABLE email_draft_defaults
  ADD COLUMN timecode_seconds INTEGER;
''';

/// v5 - when each record was last copied out for a handbook build.
///
/// The Email Critique Library's export (see `handbook_export.dart`) hands a
/// batch of records to an LLM to be turned into a handbook. Doing that twice
/// with the same records is not an error, but it is nearly always a mistake:
/// the second handbook is built from advice the first one already absorbed.
/// This column is what lets the copy dialog say "you took this one nine days
/// ago" before it happens again.
///
/// Deliberately not written by `saveRecord`. Editing a record must never
/// disturb its copy history, and the surest way to guarantee that is for the
/// upsert not to name this column at all - `markRecordsCopied` is the only
/// writer. Nullable, with "never copied" as the absence of a value rather
/// than an epoch sentinel.
const _v5 = '''
ALTER TABLE email_records
  ADD COLUMN last_copied_at TEXT;
''';

/// v6 - drafts and the owner's verdicts on them (plan, slice 3).
///
/// The library already holds "an email + a verdict on it"; skill factory
/// drafts become one more kind of record. `source` says which kind (`video`
/// for every row written before this), `source_ref` is a bench draft's id so a
/// second import of the same run adds nothing, and `knobs` / `facts` are JSON
/// objects: the situation a draft was written under, which the factory drafts
/// again for a bad one. `verdict` is `good` / `bad` or null for not rated.
///
/// The factory reads these with `pipeline/tools/email_library.py --verdicts`
/// and never writes them (decision D41); its test builds this exact shape.
const _v6 = '''
ALTER TABLE email_records ADD COLUMN verdict TEXT;
ALTER TABLE email_records ADD COLUMN verdict_note TEXT NOT NULL DEFAULT '';
ALTER TABLE email_records ADD COLUMN verdict_at TEXT;
ALTER TABLE email_records ADD COLUMN source TEXT NOT NULL DEFAULT 'video';
ALTER TABLE email_records ADD COLUMN source_ref TEXT;
ALTER TABLE email_records ADD COLUMN knobs TEXT NOT NULL DEFAULT '';
ALTER TABLE email_records ADD COLUMN facts TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS email_records_source_ref
  ON email_records (source_ref);
''';
