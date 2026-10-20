import type { Migration } from "../migrate";

// The mirror of Supabase's `member_access` (step 3d-2a): each member's agency roles and their
// "sees money" switch, kept apart from access (`profiles.role`). `roles` is a JSON array of role
// names; `sees_money` is 0 or 1. No row means no roles and no money.
const sql = `
CREATE TABLE member_access (
  profile_id TEXT PRIMARY KEY,
  roles      TEXT NOT NULL,
  sees_money INTEGER NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

export const memberAccess: Migration = { version: 2, name: "member-access", sql };
