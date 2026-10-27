import type { Migration } from "../migrate";

// Step 7: the owner's comments from prototype mode (ADR 0004). Only `prototype.db` holds any; the
// other databases get the empty table with the rest of the schema. The example reseed doesn't list
// it, so picking a scenario keeps the comments. `place` and `anchor` are JSON (`CommentPlace`,
// `CommentAnchor` in the IPC package).
const sql = `
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','done')),
  done_at INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('fix','idea','question')),
  body TEXT NOT NULL,
  scenario TEXT NOT NULL,
  place TEXT NOT NULL,
  anchor TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX comments_at ON comments (at);
`;

export const comments: Migration = { version: 5, name: "comments", sql };
