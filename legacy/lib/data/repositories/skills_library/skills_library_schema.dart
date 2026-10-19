import 'package:gratovo_toolbox/core/local_db/local_db.dart';

/// The Skills page's SQLite schema, as an append-only migration list. See
/// `EmailLibrarySpec` (`email_library_schema.dart`) for the rule this
/// follows: never edit a shipped element, only append.
const skillsLibrarySpec = LocalDbSpec(
  fileName: 'skills_library.db',
  migrations: _migrations,
);

const _migrations = <String>[_v1, _v2, _v3];

/// v1 — groups and their cards.
///
/// `position` is a plain integer rather than a fractional rank: reordering
/// rewrites every affected row in one transaction (see
/// `reorderSections`), so there is never a case that needs to insert between
/// two existing ranks without touching them.
const _v1 = '''
CREATE TABLE IF NOT EXISTS skill_groups (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  exported_at  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS skill_groups_name ON skill_groups (name);

CREATE TABLE IF NOT EXISTS skill_sections (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES skill_groups (id) ON DELETE CASCADE,
  heading     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS skill_sections_group
  ON skill_sections (group_id, position);
''';

/// v2 — the "team only" tag: a card meant for whoever else opens this deck,
/// never for Gemini. Defaults to 0 (send it) so every card written before
/// this migration keeps exporting exactly as it did.
const _v2 = '''
ALTER TABLE skill_sections
  ADD COLUMN team_only INTEGER NOT NULL DEFAULT 0;
''';

/// v3 — a deck's Gemini gem setup (the name, description and instructions the
/// gem is created with, and the gem it became).
///
/// Its own table, one row per deck, rather than columns on `skill_groups` or
/// rows in `skill_sections`: everything that builds a skill — the export, the
/// import, the word count, the `@` reference index, the preview — reads those
/// two tables, so a gem's text stored anywhere in them would have to be
/// filtered out of every one of those. Stored here, none of them can see it.
/// Nothing existing is altered, so an older export or a file imported before
/// this migration behaves exactly as it did.
const _v3 = '''
CREATE TABLE IF NOT EXISTS skill_gem_setup (
  group_id          TEXT PRIMARY KEY REFERENCES skill_groups (id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  gem_name          TEXT NOT NULL DEFAULT '',
  gem_description   TEXT NOT NULL DEFAULT '',
  gem_instructions  TEXT NOT NULL DEFAULT '',
  gem_url           TEXT NOT NULL DEFAULT '',
  synced_at         TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
''';
