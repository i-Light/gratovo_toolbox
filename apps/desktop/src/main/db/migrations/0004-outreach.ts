import type { Migration } from "../migrate";

// Step 6a: Reach's local tables (plan D1, D2). `outreach_drafts` holds the emails waiting for a
// person (and the last day's sent or skipped ones), `outreach_messages` every email in or out per
// creator, `outreach_sequences` the follow-up plan of each creator. They are local to the open
// data source for now; step T maps them to the server. Python's mailbox.db stays the record of
// what Gmail did.
const sql = `
CREATE TABLE outreach_drafts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('first','followUp','reply')),
  follow_up INTEGER,
  state TEXT NOT NULL CHECK (state IN ('drafting','ready','approved','scheduled','sending','sent','skipped','failed')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  mailbox TEXT,
  send_at INTEGER,
  approved_by TEXT,
  proposal TEXT,
  gates_ok TEXT NOT NULL DEFAULT '[]',
  edited INTEGER NOT NULL DEFAULT 0,
  checked_text TEXT,
  steer TEXT,
  reply_to TEXT,
  problem TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX outreach_drafts_open ON outreach_drafts (channel_id) WHERE state NOT IN ('sent','skipped');

CREATE TABLE outreach_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  kind TEXT CHECK (kind IN ('first','followUp','reply')),
  follow_up INTEGER,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  body_cut INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  mailbox TEXT,
  peer TEXT,
  peer_name TEXT,
  conversation_key TEXT,
  gmail_message_id TEXT UNIQUE,
  gmail_thread_id TEXT,
  draft_id TEXT,
  by TEXT,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','sweep','pasted','imported')),
  reading TEXT,
  facts_saved TEXT NOT NULL DEFAULT '[]'
) STRICT;

CREATE INDEX outreach_messages_thread ON outreach_messages (channel_id, at);

CREATE TABLE outreach_sequences (
  channel_id TEXT PRIMARY KEY,
  conversation_key TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  steps TEXT NOT NULL,
  stopped TEXT CHECK (stopped IN ('you','replied','bounced','finished')),
  park_until INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;
`;

export const outreach: Migration = { version: 4, name: "outreach", sql };
