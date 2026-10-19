/// The app's half of the local database, as plain SQLite DDL.
///
/// There is ONE local database, `data/database/gratovo.db`, shared with the
/// Python pipeline. The pipeline owns the scraped tables — `channels`,
/// `videos`, `keywords`, `channel_keywords`, `channel_archive`, `runs`,
/// `news_sources`, `news_items` — and creates them itself (`store.init_db`).
/// This file defines the tables the APP owns in the same file: everything a
/// person types in and the team shares through Supabase, plus the sync
/// bookkeeping. Neither side touches the other's tables, and both open the
/// file in WAL mode with a busy timeout, which is what lets a search run and
/// the app write at the same time.
///
/// Three properties of these tables are not obvious from the Postgres schema
/// they mirror, and every query in `lib/data/repositories/mirror/` depends on
/// them:
///
///  * **A Postgres `text[]` or `jsonb` is stored as a JSON *string*.** So
///    `channel_tags` is `'["qualified"]'` locally rather than a list: every
///    read decodes it and every filter goes through `json_each`.
///  * **Timestamps are ISO-8601 text.** Which sorts correctly as text and
///    parses correctly in `julianday()`.
///  * **`influencer_channels` is a VIEW**, not a table: the pipeline's
///    `channels` row joined with this app's `channel_state` row, in the column
///    shape the influencer list's SQL was written against. The scraped half
///    and the typed-in half of a channel live in different tables owned by
///    different programs, and the view is what keeps that split out of every
///    query.
library;

/// Bumped whenever the tables, indexes or view below change shape.
///
/// A mismatch is repaired IN PLACE, forward only — see [kAppSchemaMigrations].
/// This file is not a cache any more: it is the team's typed-in data on this
/// machine, some of it possibly not yet uploaded, sitting next to the
/// pipeline's scraped data. Deleting it to "rebuild from the server" would
/// throw away the pipeline's tables along with it.
///
/// A change that cannot be expressed as an additive migration (a retype, a
/// rename) is done the way the pipeline does it: a new column added and the
/// old one left in place, or an action in `data/reset_manifest.json` that
/// sets the whole file aside for manual merge.
const int kAppSchemaVersion = 4;

/// Keys used in `_sync_meta`. Named rather than spelled out at each call site,
/// because a typo in a string key is a silent full re-sync.
class MirrorMetaKeys {
  const MirrorMetaKeys._();

  static const schemaVersion = 'app_schema_version';
  static const hasSynced = 'has_synced';
  static const lastSyncedAt = 'last_synced_at';

  /// The watermark for one pulled table: the highest cursor value applied so
  /// far, and the key that broke its tie. Two rows per table.
  static String cursorValue(String table) => 'cursor.$table.value';
  static String cursorKey(String table) => 'cursor.$table.key';

  /// How many rows this table asks for per page, when that is not the default.
  static String pageSize(String table) => 'page_size.$table';
}

/// `_sync_meta` keys this version no longer writes, as SQL `LIKE` patterns.
///
/// `schema_version` was the old mirror's version gate, whose value meant
/// "delete the file". It must not be read by this version: the row is removed
/// on open so it cannot be mistaken for [MirrorMetaKeys.schemaVersion].
/// `cursor.channels.%` and friends belong to tables that are no longer pulled
/// from Supabase.
const List<String> kMirrorRetiredMetaKeyPatterns = <String>[
  'page_ok.%',
  'schema_version',
  'cursor.channels.%',
  'cursor.videos.%',
  'cursor.channel_keywords.%',
  'cursor.channel_archive.%',
  'cursor.channel_outreach_counts.%',
  'page_size.channels',
  'page_size.videos',
  'page_size.channel_keywords',
  'page_size.channel_archive',
  'page_size.channel_outreach_counts',
];

/// The app-owned tables. Applied in one `execute` on every open; every
/// statement is `IF NOT EXISTS`, so this is a no-op on a file that has them.
///
/// Column for column with `backend/schema.sql`, so the puller's row mappers and
/// the uploader's row payloads are the identity as far as possible.
const String kAppTablesDdl = '''
  CREATE TABLE IF NOT EXISTS channel_state (
    channel_id TEXT PRIMARY KEY, handle TEXT, vetting_status TEXT,
    relevance_criteria TEXT, notes TEXT, pipeline_stage TEXT,
    channel_tags TEXT, contacts TEXT, provided_data TEXT,
    archive_due_at TEXT, last_deal_at TEXT, last_edited_by TEXT,
    last_edited_by_name TEXT, updated_at TEXT,
    owner_id TEXT, manual_engagement_rate REAL, manual_engagement_note TEXT,
    manual_engagement_updated_at TEXT, media_kit TEXT, creator_gender TEXT
  );
  CREATE TABLE IF NOT EXISTS edit_conflicts (
    id TEXT PRIMARY KEY, channel_id TEXT, channel_label TEXT, field TEXT,
    base_value TEXT, mine_value TEXT, theirs_value TEXT,
    mine_actor_id TEXT, mine_actor_name TEXT, theirs_actor_name TEXT,
    detected_at TEXT, resolved_at TEXT, resolved_by TEXT,
    resolved_by_name TEXT, resolution TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY, name TEXT, contact_name TEXT, contact_email TEXT,
    contact_phone TEXT, website TEXT, budget REAL, campaign_brief TEXT,
    preferred_criteria TEXT, notes TEXT, created_at TEXT, updated_at TEXT,
    category TEXT, country TEXT, contacts TEXT, budget_currency TEXT,
    source TEXT
  );
  CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY, brand_id TEXT, channel_id TEXT, stage TEXT,
    brand_price REAL, influencer_payout REAL, deliverables TEXT,
    deadline TEXT, contract_url TEXT, notes TEXT,
    working_days_estimate INTEGER, created_at TEXT, updated_at TEXT,
    campaign_id TEXT, owner_id TEXT, currency TEXT,
    brand_invoice_sent_at TEXT, brand_invoice_paid_at TEXT,
    creator_payout_due_at TEXT, creator_payout_paid_at TEXT,
    payment_method TEXT, payment_reference TEXT,
    payment_terms TEXT, tracking_link TEXT,
    creator_contract_url TEXT, creator_contract_status TEXT,
    creator_signed_at TEXT, brand_contract_url TEXT,
    brand_contract_status TEXT, brand_signed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS outreach_threads (
    id TEXT PRIMARY KEY, channel_id TEXT, deal_id TEXT, status TEXT,
    updated_at TEXT, owner_id TEXT, brand_id TEXT, contact_email TEXT
  );
  CREATE TABLE IF NOT EXISTS outreach_messages (
    id TEXT PRIMARY KEY, thread_id TEXT, direction TEXT, method TEXT,
    subject TEXT, body TEXT, peer_email TEXT, at TEXT,
    is_ai_drafted INTEGER, template_id TEXT, updated_at TEXT,
    classification TEXT
  );
  CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY, name TEXT, subject TEXT, body TEXT, kind TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS writing_rules (
    id TEXT PRIMARY KEY, text TEXT, sort_order INTEGER, created_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS follow_up_reminders (
    id TEXT PRIMARY KEY, title TEXT, due_at TEXT, kind TEXT, channel_id TEXT,
    deal_id TEXT, is_done INTEGER, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY, at TEXT, actor_id TEXT, actor_name TEXT,
    actor_role TEXT, action TEXT, entity_type TEXT, entity_id TEXT,
    entity_label TEXT, field TEXT, old_value TEXT, new_value TEXT,
    detail TEXT,
    -- 0 for an entry written on this machine and not yet uploaded. The
    -- uploader sends `synced = 0` rows in batches and flips them; a row that
    -- arrived by pull is inserted at 1. Append-only, like the server table.
    synced INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY, display_name TEXT, color TEXT, role TEXT,
    created_at TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS scratchpads (
    user_id TEXT PRIMARY KEY, body TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS remote_search_requests (
    id TEXT PRIMARY KEY, from_user_id TEXT, to_user_id TEXT, keywords TEXT,
    status TEXT, created_at TEXT, applied_at TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS _client_merge_status (
    user_id TEXT PRIMARY KEY, pending_count INTEGER, entries TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY, brand_id TEXT, name TEXT, notes TEXT, status TEXT,
    start_date TEXT, live_date TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS campaign_shortlist (
    id TEXT PRIMARY KEY, campaign_id TEXT, channel_id TEXT, why_fit TEXT,
    price_basis_snapshot TEXT, added_at TEXT
  );
  CREATE TABLE IF NOT EXISTS deliverables (
    id TEXT PRIMARY KEY, deal_id TEXT, type TEXT, agreed_date TEXT,
    draft_received_date TEXT, approved_date TEXT, published_url TEXT,
    status TEXT, notes TEXT, sort_order INTEGER, created_at TEXT,
    updated_at TEXT, published_at TEXT, report_views INTEGER,
    report_views_at TEXT, report_clicks INTEGER
  );
  CREATE TABLE IF NOT EXISTS channel_rate_history (
    id TEXT PRIMARY KEY, channel_id TEXT, deal_id TEXT, brand_price REAL,
    influencer_payout REAL, median_views_at_deal INTEGER, closed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sequences (
    id TEXT PRIMARY KEY, name TEXT, description TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sequence_steps (
    id TEXT PRIMARY KEY, sequence_id TEXT, step_no INTEGER,
    template_id TEXT, delay_days INTEGER, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS agency_settings (
    id TEXT PRIMARY KEY, body TEXT, updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS comms_proposals (
    id TEXT PRIMARY KEY, thread_id TEXT, channel_id TEXT, brand_id TEXT,
    kind TEXT, status TEXT, engine_status TEXT, situation TEXT, steer TEXT,
    action TEXT, why TEXT, rules TEXT, needs_human TEXT, subject TEXT,
    body TEXT, follow_up_days INTEGER, variant TEXT, model TEXT, error TEXT,
    decided_by TEXT, decided_at TEXT, created_at TEXT, updated_at TEXT
  );
  -- Per-machine only — never synced to Supabase (see this file's doc
  -- comment). Backs the generic job scheduler: `kind`/`cadence` are free
  -- text owned by whichever feature registers a job, `config` is that
  -- job's own JSON-string parameters.
  CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, cadence TEXT NOT NULL,
    last_run_at TEXT, next_run_at TEXT, enabled INTEGER NOT NULL DEFAULT 1,
    config TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
''';

/// The pipeline's `channels` row and this app's `channel_state` row, as one.
///
/// Every column the influencer list, the profile page, the dashboard and the
/// bulk tools read, in one place:
///
///  * scraped facts from `channels` (the pipeline's shape: `subscribers` is
///    TEXT there, whatever YouTube returned, so it is cast here);
///  * rollups the pipeline computed locally (`videos_last_30` and friends);
///  * the R2 bookkeeping that says whether this machine has the channel's
///    details and videos yet (`blob_version` vs `blob_applied_version`);
///  * typed-in state from `channel_state`, with the defaults every
///    never-touched channel implicitly has;
///  * the outbound-message count, derived from the local outreach tables.
///
/// A view rather than a table because the two halves are written by two
/// programs, and a copy would be a third thing to keep in step. `DROP VIEW`
/// before `CREATE` on every open, so a change to this definition needs no
/// migration of its own.
const String kInfluencerChannelsViewDdl = '''
  DROP VIEW IF EXISTS influencer_channels;
  CREATE VIEW influencer_channels AS
  SELECT c.channel_id AS id, c.channel_id, c.handle, c.name, c.description,
         c.profile_picture, c.banner,
         CAST(NULLIF(REPLACE(c.subscribers, ',', ''), '') AS INTEGER) AS subscribers,
         c.country, c.link, c.first_seen_at, c.last_fetched_at,
         c.videos_fetched_at,
         COALESCE(c.videos_last_30, 0) AS videos_last_30,
         c.median_views_last_30, c.latest_upload_at,
         c.blob_version, c.blob_applied_version, c.blob_uploaded_at,
         c.sponsored_ratio, c.seen_brands, c.found_emails,
         s.notes, s.relevance_criteria, s.provided_data,
         COALESCE(s.vetting_status, 'newlyFound') AS vetting_status,
         COALESCE(s.pipeline_stage, 'new') AS pipeline_stage,
         COALESCE(s.channel_tags, '[]') AS channel_tags,
         COALESCE(s.contacts, '[]') AS contacts,
         s.last_deal_at, s.archive_due_at, s.last_edited_by_name,
         s.owner_id, s.manual_engagement_rate, s.manual_engagement_note,
         s.manual_engagement_updated_at, s.media_kit, s.creator_gender,
         (SELECT COUNT(*) FROM outreach_messages m
            JOIN outreach_threads t ON t.id = m.thread_id
           WHERE t.channel_id = c.channel_id AND m.direction = 'outbound')
           AS outreach_outbound_count
    FROM channels c
    LEFT JOIN channel_state s ON s.channel_id = c.channel_id;
''';

/// Indexes on the app-owned tables. The pipeline keeps its own on its tables
/// (`idx_channels_handle`, the rollup columns, …).
const String kAppIndexesDdl = '''
  CREATE INDEX IF NOT EXISTS idx_channel_state_stage
    ON channel_state (pipeline_stage);
  CREATE INDEX IF NOT EXISTS idx_channel_state_vetting
    ON channel_state (vetting_status);
  CREATE INDEX IF NOT EXISTS idx_channel_state_archive_due
    ON channel_state (archive_due_at);
  CREATE INDEX IF NOT EXISTS idx_channel_state_last_deal
    ON channel_state (last_deal_at DESC);
  CREATE INDEX IF NOT EXISTS idx_edit_conflicts_channel
    ON edit_conflicts (channel_id);
  CREATE INDEX IF NOT EXISTS idx_edit_conflicts_detected
    ON edit_conflicts (detected_at DESC);
  CREATE INDEX IF NOT EXISTS idx_deals_channel ON deals (channel_id);
  CREATE INDEX IF NOT EXISTS idx_deals_brand ON deals (brand_id);
  CREATE INDEX IF NOT EXISTS idx_threads_channel ON outreach_threads (channel_id);
  CREATE INDEX IF NOT EXISTS idx_messages_thread
    ON outreach_messages (thread_id, at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_direction_at
    ON outreach_messages (direction, at);
  CREATE INDEX IF NOT EXISTS idx_reminders_due
    ON follow_up_reminders (is_done, due_at);
  CREATE INDEX IF NOT EXISTS idx_reminders_channel
    ON follow_up_reminders (channel_id);
  CREATE INDEX IF NOT EXISTS idx_activity_log_at ON activity_log (at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_log_unsynced
    ON activity_log (synced) WHERE synced = 0;
  CREATE INDEX IF NOT EXISTS idx_remote_search_requests_to_user
    ON remote_search_requests (to_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_campaigns_brand ON campaigns (brand_id);
  CREATE INDEX IF NOT EXISTS idx_campaign_shortlist_campaign
    ON campaign_shortlist (campaign_id);
  CREATE INDEX IF NOT EXISTS idx_deliverables_deal ON deliverables (deal_id);
  CREATE INDEX IF NOT EXISTS idx_channel_rate_history_channel
    ON channel_rate_history (channel_id);
  CREATE INDEX IF NOT EXISTS idx_channel_rate_history_deal
    ON channel_rate_history (deal_id);
  CREATE INDEX IF NOT EXISTS idx_sequence_steps_sequence
    ON sequence_steps (sequence_id);
  CREATE INDEX IF NOT EXISTS idx_sequence_steps_template
    ON sequence_steps (template_id);
  CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run
    ON scheduled_jobs (enabled, next_run_at);
  CREATE INDEX IF NOT EXISTS idx_comms_proposals_thread
    ON comms_proposals (thread_id);
  CREATE INDEX IF NOT EXISTS idx_comms_proposals_status
    ON comms_proposals (status, created_at);
''';

/// The pipeline's `channels` table, as far as the app needs it to exist before
/// the pipeline has ever run on this machine.
///
/// The pipeline is the owner and creates the full shape (`store.init_db`); a
/// brand-new install may open the app before any `search.py` has run, and the
/// view above needs the table to exist. This is the pipeline's own DDL for the
/// columns the view reads, verbatim, and is a no-op once the pipeline has been
/// here. The two must agree — `pipeline/gratovo/store.py` is the source.
const String kPipelineTablesBootstrapDdl = '''
  CREATE TABLE IF NOT EXISTS channels (
    channel_id TEXT PRIMARY KEY, handle TEXT NOT NULL, name TEXT,
    description TEXT, subscribers TEXT, profile_picture TEXT, banner TEXT,
    link TEXT, country TEXT, first_seen_at TEXT NOT NULL,
    last_fetched_at TEXT, last_fetch_status TEXT, videos_fetched_at TEXT,
    force_refetch INTEGER NOT NULL DEFAULT 0,
    videos_last_30 INTEGER NOT NULL DEFAULT 0, median_views_last_30 INTEGER,
    latest_upload_at TEXT, blob_uploaded_at TEXT, blob_version TEXT,
    blob_applied_version TEXT, blob_announced_version TEXT, announced_at TEXT,
    sponsored_ratio REAL, seen_brands TEXT, found_emails TEXT
  );
  CREATE TABLE IF NOT EXISTS channel_keywords (
    channel_id TEXT NOT NULL REFERENCES channels(channel_id), keyword TEXT NOT NULL,
    discovered_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'local',
    announced INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, keyword)
  );
  CREATE TABLE IF NOT EXISTS videos (
    video_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(channel_id), title TEXT,
    description TEXT, thumbnail TEXT, tags TEXT, published_at TEXT,
    view_count TEXT, last_fetched_at TEXT, last_fetch_status TEXT
  );
  CREATE TABLE IF NOT EXISTS channel_archive (
    channel_id TEXT PRIMARY KEY, handle TEXT, label TEXT, archived_at TEXT,
    subscribers TEXT, found_at TEXT, found_via TEXT, source TEXT,
    announced INTEGER NOT NULL DEFAULT 0, median_views_last_30 INTEGER,
    videos_found_count INTEGER, median_basis TEXT
  );
  CREATE TABLE IF NOT EXISTS news_sources (
    id TEXT PRIMARY KEY, feed_url TEXT NOT NULL UNIQUE, title TEXT,
    niche TEXT, enabled INTEGER NOT NULL DEFAULT 1, added_at TEXT NOT NULL,
    last_fetched_at TEXT, last_fetch_status TEXT, last_fetch_error TEXT
  );
  CREATE TABLE IF NOT EXISTS news_items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES news_sources(id) ON DELETE CASCADE,
    guid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, link TEXT, summary TEXT, author TEXT,
    image_url TEXT, published_at TEXT, fetched_at TEXT NOT NULL
  );
''';

/// Indexes on the pipeline's tables for the reads THIS app makes of them.
///
/// The pipeline indexes its tables for its own work (handles, the blob and
/// announce queues) and never sorts a roster; the app does, on every open of
/// the influencer list and the archive page, and without these the default
/// sort of each was a full scan and sort of the largest table in the file —
/// measurable at a few thousand rows and a stall at a hundred thousand.
///
/// The two `subscribers` indexes and the `videos_last_30` one are on the
/// exact expression the `influencer_channels` view and the archive query sort
/// by (the cast, the COALESCE), because an index only answers an ORDER BY
/// whose expression matches it textually. `DESC` with the id tie-break
/// matches the direction the screens open in; ascending still sorts, the
/// same as before.
///
/// The pipeline's `init_db` creates the same indexes, statement for statement,
/// so a fresh file gets them from whichever side opens it first. Keep the two
/// lists identical — `pipeline/gratovo/store.py` is the source.
const String kPipelineIndexesDdl = '''
  CREATE INDEX IF NOT EXISTS idx_channels_subscribers_num
    ON channels (CAST(NULLIF(REPLACE(subscribers, ',', ''), '') AS INTEGER) DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channels_median_views
    ON channels (median_views_last_30 DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channels_videos_last_30
    ON channels (COALESCE(videos_last_30, 0) DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channels_latest_upload
    ON channels (latest_upload_at DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channels_first_seen
    ON channels (first_seen_at DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_videos_channel_published
    ON videos (channel_id, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_channel_archive_archived_at
    ON channel_archive (archived_at DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channel_archive_label_archived_at
    ON channel_archive (label, archived_at DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channel_archive_handle
    ON channel_archive (handle DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channel_archive_subscribers_num
    ON channel_archive (CAST(NULLIF(REPLACE(subscribers, ',', ''), '') AS INTEGER) DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channel_archive_median_views
    ON channel_archive (median_views_last_30 DESC, channel_id);
  CREATE INDEX IF NOT EXISTS idx_channel_archive_videos_found
    ON channel_archive (videos_found_count DESC, channel_id);
''';

/// The two tables that are not data.
///
/// `_sync_meta` is the answer to "where was I?" — the per-table watermarks and
/// whether a first full sync has ever finished. `_outbox` is the answer to
/// "what have I not sent yet?".
///
/// The outbox stores INTENT, not row operations: a `kind` naming what the
/// person did and a JSON payload holding what it needs. See
/// `mirror_outbox.dart`.
const String kMirrorBookkeepingDdl = '''
  CREATE TABLE IF NOT EXISTS _sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS _outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
''';

/// Every table and index, in the order they must be applied on every open.
///
/// Without the view: an older file gets its missing columns from
/// [kAppSchemaMigrations] first, and only then can a view that reads them be
/// created (SQLite also re-checks every view when a column is added, so the
/// old view must still be the one in place while the migrations run).
const String kAppSchemaTablesDdl = '$kMirrorBookkeepingDdl\n'
    '$kPipelineTablesBootstrapDdl\n'
    '$kAppTablesDdl\n'
    '$kAppIndexesDdl\n'
    '$kPipelineIndexesDdl';

/// Everything, for a brand-new file that needs no migration.
const String kAppSchemaDdl =
    '$kAppSchemaTablesDdl\n$kInfluencerChannelsViewDdl';

/// Forward-only migrations, keyed by the version they bring the file TO.
///
/// Run in order after [kAppSchemaDdl] for every version above the stored one.
/// Version 1 is the DDL itself, so the map starts empty; a later change adds
/// `2: ['ALTER TABLE ... ADD COLUMN ...']` and bumps [kAppSchemaVersion].
/// Guarded `ALTER TABLE ADD COLUMN` is the only shape that belongs here — the
/// same rule the pipeline's `init_db` follows for its own tables.
const Map<int, List<String>> kAppSchemaMigrations = <int, List<String>>{
  // `channel_archive` is the pipeline's table, and the pipeline's own
  // `_migrate` adds this same column — but either program can be the first to
  // open a file after an update, and the sweep on this side writes the column.
  // Both sides carry the ALTER for that reason; whichever runs second gets a
  // `duplicate column` and swallows it.
  2: ['ALTER TABLE channel_archive ADD COLUMN median_basis TEXT'],
  // 1.3: the new local columns behind campaigns, invoicing/ownership and
  // manual engagement — the tables themselves are created by kAppTablesDdl
  // above (new tables need no migration; only columns added to tables that
  // already existed on machines running an earlier version do).
  3: [
    'ALTER TABLE deals ADD COLUMN campaign_id TEXT',
    'ALTER TABLE deals ADD COLUMN owner_id TEXT',
    'ALTER TABLE deals ADD COLUMN currency TEXT',
    'ALTER TABLE deals ADD COLUMN brand_invoice_sent_at TEXT',
    'ALTER TABLE deals ADD COLUMN brand_invoice_paid_at TEXT',
    'ALTER TABLE deals ADD COLUMN creator_payout_due_at TEXT',
    'ALTER TABLE deals ADD COLUMN creator_payout_paid_at TEXT',
    'ALTER TABLE deals ADD COLUMN payment_method TEXT',
    'ALTER TABLE deals ADD COLUMN payment_reference TEXT',
    'ALTER TABLE channel_state ADD COLUMN owner_id TEXT',
    'ALTER TABLE channel_state ADD COLUMN manual_engagement_rate REAL',
    'ALTER TABLE channel_state ADD COLUMN manual_engagement_note TEXT',
    'ALTER TABLE channel_state ADD COLUMN manual_engagement_updated_at TEXT',
    'ALTER TABLE outreach_threads ADD COLUMN owner_id TEXT',
    'ALTER TABLE outreach_messages ADD COLUMN classification TEXT',
  ],
  // 1.4, the owner's decisions of 2026-10-18 (backend/schema.sql section 4.6):
  // media kit and creator flag, brand contacts, payment terms and the two
  // contracts, the 30-day report, brand threads. The two new tables come from
  // kAppTablesDdl. `channels` is the pipeline's: its derived sponsorship and
  // found-email columns are added by whichever program opens the file first,
  // the same arrangement as version 2.
  4: [
    'ALTER TABLE channel_state ADD COLUMN media_kit TEXT',
    'ALTER TABLE channel_state ADD COLUMN creator_gender TEXT',
    'ALTER TABLE brands ADD COLUMN category TEXT',
    'ALTER TABLE brands ADD COLUMN country TEXT',
    'ALTER TABLE brands ADD COLUMN contacts TEXT',
    'ALTER TABLE brands ADD COLUMN budget_currency TEXT',
    'ALTER TABLE brands ADD COLUMN source TEXT',
    'ALTER TABLE deals ADD COLUMN payment_terms TEXT',
    'ALTER TABLE deals ADD COLUMN tracking_link TEXT',
    'ALTER TABLE deals ADD COLUMN creator_contract_url TEXT',
    'ALTER TABLE deals ADD COLUMN creator_contract_status TEXT',
    'ALTER TABLE deals ADD COLUMN creator_signed_at TEXT',
    'ALTER TABLE deals ADD COLUMN brand_contract_url TEXT',
    'ALTER TABLE deals ADD COLUMN brand_contract_status TEXT',
    'ALTER TABLE deals ADD COLUMN brand_signed_at TEXT',
    'ALTER TABLE deliverables ADD COLUMN published_at TEXT',
    'ALTER TABLE deliverables ADD COLUMN report_views INTEGER',
    'ALTER TABLE deliverables ADD COLUMN report_views_at TEXT',
    'ALTER TABLE deliverables ADD COLUMN report_clicks INTEGER',
    'ALTER TABLE outreach_threads ADD COLUMN brand_id TEXT',
    'ALTER TABLE outreach_threads ADD COLUMN contact_email TEXT',
    'CREATE INDEX IF NOT EXISTS idx_threads_brand ON outreach_threads (brand_id)',
    'ALTER TABLE channels ADD COLUMN sponsored_ratio REAL',
    'ALTER TABLE channels ADD COLUMN seen_brands TEXT',
    'ALTER TABLE channels ADD COLUMN found_emails TEXT',
  ],
};

/// The app-owned tables that hold PULLED data, for the wipe a full re-sync
/// performs when this machine's tombstone cursor has fallen behind the
/// server's purge horizon.
///
/// `_outbox` and unsynced `activity_log` rows are deliberately not wiped: a
/// re-sync throws away downloaded data, which the server can send again, and
/// must never throw away unsent local work, which nothing can. Nothing of the
/// pipeline's is touched either — that is not this database's to wipe.
const List<String> kAppPulledTables = [
  'channel_state',
  'edit_conflicts',
  'brands',
  'deals',
  'outreach_threads',
  'outreach_messages',
  'email_templates',
  'writing_rules',
  'follow_up_reminders',
  'profiles',
  'scratchpads',
  'remote_search_requests',
  'campaigns',
  'campaign_shortlist',
  'deliverables',
  'channel_rate_history',
  'sequences',
  'sequence_steps',
  'agency_settings',
  'comms_proposals',
];
