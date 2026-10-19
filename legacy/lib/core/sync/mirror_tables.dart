/// What the mirror pulls: one [MirrorTable] spec per table, in the order a
/// first sync fills them, and the tombstone → local delete for each.
/// `mirror_puller.dart` is the machinery; this is the list it runs down.
library;

import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/core/sync/sync_diagnostics.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';

/// One mirrored table: what to ask Supabase for, how to order it, and how the
/// row becomes a local row.
class MirrorTable {
  const MirrorTable({
    required this.name,
    required this.cursor,
    required this.keys,
    required this.remoteColumns,
    required this.localColumns,
    required this.toLocal,
  });

  final String name;

  /// The server-set timestamp this table is paged by.
  final String cursor;

  /// The primary key, in order, breaking ties within one [cursor] value.
  final List<String> keys;

  /// What to select over PostgREST. Includes [cursor] even where the column is
  /// not stored locally, because the paging needs it.
  final List<String> remoteColumns;

  /// The local column list, in the order [toLocal] fills it.
  final List<String> localColumns;

  final Map<String, Object?> Function(Map<String, dynamic>) toLocal;
}

/// For tables whose local columns are the server's columns, unchanged.
Map<String, Object?> identityRow(Map<String, dynamic> row) => row;

/// Every pulled table, in the order a first sync fills them.
///
/// All of them are the app's own typed-in tables; nothing scraped is pulled
/// from Supabase any more (see `mirror_schema.dart`). Every one has a
/// server-stamped `updated_at` as its cursor and a tombstone trigger, and the
/// local column list is the server's column list, so the row mappers are the
/// identity apart from JSON encoding.
///
/// Unlike the sync rules this replaced, this list is the ONLY place the
/// pulled columns are written down; a Dart list the compiler checks against
/// the insert it feeds is a small thing to keep honest.
const List<MirrorTable> mirrorTables = [
  MirrorTable(
    name: 'profiles',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'display_name',
      'color',
      'role',
      'created_at',
      'updated_at'
    ],
    localColumns: [
      'id',
      'display_name',
      'color',
      'role',
      'created_at',
      'updated_at'
    ],
    toLocal: identityRow,
  ),
  MirrorTable(
    name: 'channel_state',
    cursor: 'updated_at',
    keys: ['channel_id'],
    remoteColumns: [
      'channel_id',
      'handle',
      'vetting_status',
      'relevance_criteria',
      'notes',
      'pipeline_stage',
      'channel_tags',
      'contacts',
      'provided_data',
      'archive_due_at',
      'last_deal_at',
      'last_edited_by',
      'last_edited_by_name',
      'updated_at',
      // 1.3: ownership and manual engagement entry.
      'owner_id',
      'manual_engagement_rate',
      'manual_engagement_note',
      'manual_engagement_updated_at',
      // 1.4: media kit and the creator flag (HC-08).
      'media_kit',
      'creator_gender',
    ],
    localColumns: [
      'channel_id',
      'handle',
      'vetting_status',
      'relevance_criteria',
      'notes',
      'pipeline_stage',
      'channel_tags',
      'contacts',
      'provided_data',
      'archive_due_at',
      'last_deal_at',
      'last_edited_by',
      'last_edited_by_name',
      'updated_at',
      'owner_id',
      'manual_engagement_rate',
      'manual_engagement_note',
      'manual_engagement_updated_at',
      'media_kit',
      'creator_gender',
    ],
    toLocal: _channelStateRow,
  ),
  MirrorTable(
    name: 'edit_conflicts',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'channel_id',
      'channel_label',
      'field',
      'base_value',
      'mine_value',
      'theirs_value',
      'mine_actor_id',
      'mine_actor_name',
      'theirs_actor_name',
      'detected_at',
      'resolved_at',
      'resolved_by',
      'resolved_by_name',
      'resolution',
      'updated_at',
    ],
    localColumns: [
      'id',
      'channel_id',
      'channel_label',
      'field',
      'base_value',
      'mine_value',
      'theirs_value',
      'mine_actor_id',
      'mine_actor_name',
      'theirs_actor_name',
      'detected_at',
      'resolved_at',
      'resolved_by',
      'resolved_by_name',
      'resolution',
      'updated_at',
    ],
    toLocal: _conflictRow,
  ),
  MirrorTable(
    name: 'brands',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'name',
      'contact_name',
      'contact_email',
      'contact_phone',
      'website',
      'budget',
      'campaign_brief',
      'preferred_criteria',
      'notes',
      'created_at',
      'updated_at',
      // 1.4: several contacts (HC-25), where the brand is, and how it was found.
      'category',
      'country',
      'contacts',
      'budget_currency',
      'source',
    ],
    localColumns: [
      'id',
      'name',
      'contact_name',
      'contact_email',
      'contact_phone',
      'website',
      'budget',
      'campaign_brief',
      'preferred_criteria',
      'notes',
      'created_at',
      'updated_at',
      'category',
      'country',
      'contacts',
      'budget_currency',
      'source',
    ],
    toLocal: _brandRow,
  ),
  MirrorTable(
    name: 'deals',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'brand_id',
      'channel_id',
      'stage',
      'brand_price',
      'influencer_payout',
      'deliverables',
      'deadline',
      'contract_url',
      'notes',
      'working_days_estimate',
      'created_at',
      'updated_at',
      // 1.3: campaign grouping, ownership and payment tracking.
      'campaign_id',
      'owner_id',
      'currency',
      'brand_invoice_sent_at',
      'brand_invoice_paid_at',
      'creator_payout_due_at',
      'creator_payout_paid_at',
      'payment_method',
      'payment_reference',
      // 1.4: payment terms set per deal, a tracking link, the two contracts.
      'payment_terms',
      'tracking_link',
      'creator_contract_url',
      'creator_contract_status',
      'creator_signed_at',
      'brand_contract_url',
      'brand_contract_status',
      'brand_signed_at',
    ],
    localColumns: [
      'id',
      'brand_id',
      'channel_id',
      'stage',
      'brand_price',
      'influencer_payout',
      'deliverables',
      'deadline',
      'contract_url',
      'notes',
      'working_days_estimate',
      'created_at',
      'updated_at',
      'campaign_id',
      'owner_id',
      'currency',
      'brand_invoice_sent_at',
      'brand_invoice_paid_at',
      'creator_payout_due_at',
      'creator_payout_paid_at',
      'payment_method',
      'payment_reference',
      'payment_terms',
      'tracking_link',
      'creator_contract_url',
      'creator_contract_status',
      'creator_signed_at',
      'brand_contract_url',
      'brand_contract_status',
      'brand_signed_at',
    ],
    toLocal: identityRow,
  ),
  MirrorTable(
    name: 'outreach_threads',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'channel_id',
      'deal_id',
      'status',
      'updated_at',
      // 1.3: the thread's owner.
      'owner_id',
      // 1.4: a thread with a brand contact instead of a channel.
      'brand_id',
      'contact_email',
    ],
    localColumns: [
      'id',
      'channel_id',
      'deal_id',
      'status',
      'updated_at',
      'owner_id',
      'brand_id',
      'contact_email',
    ],
    toLocal: identityRow,
  ),
  MirrorTable(
    name: 'outreach_messages',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'thread_id',
      'direction',
      'method',
      'subject',
      'body',
      'peer_email',
      'at',
      'is_ai_drafted',
      'template_id',
      'updated_at',
      // 1.3: how a reply was read, for the follow-up planner.
      'classification',
    ],
    localColumns: [
      'id',
      'thread_id',
      'direction',
      'method',
      'subject',
      'body',
      'peer_email',
      'at',
      'is_ai_drafted',
      'template_id',
      'updated_at',
      'classification',
    ],
    toLocal: _messageRow,
  ),
  MirrorTable(
    name: 'email_templates',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: ['id', 'name', 'subject', 'body', 'kind', 'updated_at'],
    localColumns: ['id', 'name', 'subject', 'body', 'kind', 'updated_at'],
    toLocal: identityRow,
  ),
  MirrorTable(
    name: 'writing_rules',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: ['id', 'text', 'sort_order', 'created_at', 'updated_at'],
    localColumns: ['id', 'text', 'sort_order', 'created_at', 'updated_at'],
    toLocal: identityRow,
  ),
  MirrorTable(
    name: 'follow_up_reminders',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'title',
      'due_at',
      'kind',
      'channel_id',
      'deal_id',
      'is_done',
      'created_at',
      'updated_at',
    ],
    localColumns: [
      'id',
      'title',
      'due_at',
      'kind',
      'channel_id',
      'deal_id',
      'is_done',
      'created_at',
      'updated_at',
    ],
    toLocal: _reminderRow,
  ),
  // Append-only and never updated, so `at` (the client's stamp at write time)
  // is a valid cursor: a row can never move behind it.
  MirrorTable(
    name: 'activity_log',
    cursor: 'at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'at',
      'actor_id',
      'actor_name',
      'actor_role',
      'action',
      'entity_type',
      'entity_id',
      'entity_label',
      'field',
      'old_value',
      'new_value',
      'detail',
    ],
    localColumns: [
      'id',
      'at',
      'actor_id',
      'actor_name',
      'actor_role',
      'action',
      'entity_type',
      'entity_id',
      'entity_label',
      'field',
      'old_value',
      'new_value',
      'detail',
      'synced',
    ],
    toLocal: _activityRow,
  ),
  MirrorTable(
    name: 'scratchpads',
    cursor: 'updated_at',
    keys: ['user_id'],
    remoteColumns: ['user_id', 'body', 'updated_at'],
    localColumns: ['user_id', 'body', 'updated_at'],
    toLocal: identityRow,
  ),
  MirrorTable(
    name: 'remote_search_requests',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'from_user_id',
      'to_user_id',
      'keywords',
      'status',
      'created_at',
      'applied_at',
      'updated_at',
    ],
    localColumns: [
      'id',
      'from_user_id',
      'to_user_id',
      'keywords',
      'status',
      'created_at',
      'applied_at',
      'updated_at',
    ],
    toLocal: identityRow,
  ),
  MirrorTable(
    name: 'campaigns',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'brand_id',
      'name',
      'notes',
      'status',
      'start_date',
      'live_date',
      'created_at',
      'updated_at',
    ],
    localColumns: [
      'id',
      'brand_id',
      'name',
      'notes',
      'status',
      'start_date',
      'live_date',
      'created_at',
      'updated_at',
    ],
    toLocal: identityRow,
  ),
  // No `updated_at` on the server table — a shortlist entry is added, not
  // edited, so `added_at` (stamped once, like `activity_log.at`) is the
  // cursor.
  MirrorTable(
    name: 'campaign_shortlist',
    cursor: 'added_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'campaign_id',
      'channel_id',
      'why_fit',
      'price_basis_snapshot',
      'added_at',
    ],
    localColumns: [
      'id',
      'campaign_id',
      'channel_id',
      'why_fit',
      'price_basis_snapshot',
      'added_at',
    ],
    toLocal: _campaignShortlistRow,
  ),
  MirrorTable(
    name: 'deliverables',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'deal_id',
      'type',
      'agreed_date',
      'draft_received_date',
      'approved_date',
      'published_url',
      'status',
      'notes',
      'sort_order',
      'created_at',
      'updated_at',
      // 1.4: when it went live, and the 30-day report.
      'published_at',
      'report_views',
      'report_views_at',
      'report_clicks',
    ],
    localColumns: [
      'id',
      'deal_id',
      'type',
      'agreed_date',
      'draft_received_date',
      'approved_date',
      'published_url',
      'status',
      'notes',
      'sort_order',
      'created_at',
      'updated_at',
      'published_at',
      'report_views',
      'report_views_at',
      'report_clicks',
    ],
    toLocal: identityRow,
  ),
  // No `updated_at` — one closed deal's numbers, written once and never
  // edited (see `backend/schema.sql`'s doc comment on this table).
  // `closed_at` is the cursor, the same reasoning as `campaign_shortlist`.
  MirrorTable(
    name: 'channel_rate_history',
    cursor: 'closed_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'channel_id',
      'deal_id',
      'brand_price',
      'influencer_payout',
      'median_views_at_deal',
      'closed_at',
    ],
    localColumns: [
      'id',
      'channel_id',
      'deal_id',
      'brand_price',
      'influencer_payout',
      'median_views_at_deal',
      'closed_at',
    ],
    toLocal: identityRow,
  ),
  MirrorTable(
    name: 'sequences',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: ['id', 'name', 'description', 'updated_at'],
    localColumns: ['id', 'name', 'description', 'updated_at'],
    toLocal: identityRow,
  ),
  MirrorTable(
    name: 'sequence_steps',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'sequence_id',
      'step_no',
      'template_id',
      'delay_days',
      'updated_at',
    ],
    localColumns: [
      'id',
      'sequence_id',
      'step_no',
      'template_id',
      'delay_days',
      'updated_at',
    ],
    toLocal: identityRow,
  ),
  // 1.4: the agency's facts (one row) and the Comms queue.
  MirrorTable(
    name: 'agency_settings',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: ['id', 'body', 'updated_at'],
    localColumns: ['id', 'body', 'updated_at'],
    toLocal: _agencySettingsRow,
  ),
  MirrorTable(
    name: 'comms_proposals',
    cursor: 'updated_at',
    keys: ['id'],
    remoteColumns: [
      'id',
      'thread_id',
      'channel_id',
      'brand_id',
      'kind',
      'status',
      'engine_status',
      'situation',
      'steer',
      'action',
      'why',
      'rules',
      'needs_human',
      'subject',
      'body',
      'follow_up_days',
      'variant',
      'model',
      'error',
      'decided_by',
      'decided_at',
      'created_at',
      'updated_at',
    ],
    localColumns: [
      'id',
      'thread_id',
      'channel_id',
      'brand_id',
      'kind',
      'status',
      'engine_status',
      'situation',
      'steer',
      'action',
      'why',
      'rules',
      'needs_human',
      'subject',
      'body',
      'follow_up_days',
      'variant',
      'model',
      'error',
      'decided_by',
      'decided_at',
      'created_at',
      'updated_at',
    ],
    toLocal: _commsProposalRow,
  ),
];

Map<String, Object?> _channelStateRow(Map<String, dynamic> row) => {
      ...row,
      'relevance_criteria': encodeJsonColumn(row['relevance_criteria']),
      'provided_data': encodeJsonColumn(row['provided_data']),
      'channel_tags': encodeJsonColumn(row['channel_tags']),
      'contacts': encodeJsonColumn(row['contacts']),
      'media_kit': encodeJsonColumn(row['media_kit']),
    };

Map<String, Object?> _conflictRow(Map<String, dynamic> row) => {
      ...row,
      'base_value': encodeJsonColumn(row['base_value']),
      'mine_value': encodeJsonColumn(row['mine_value']),
      'theirs_value': encodeJsonColumn(row['theirs_value']),
    };

Map<String, Object?> _brandRow(Map<String, dynamic> row) => {
      ...row,
      'preferred_criteria': encodeJsonColumn(row['preferred_criteria']),
      'contacts': encodeJsonColumn(row['contacts']),
    };

Map<String, Object?> _agencySettingsRow(Map<String, dynamic> row) => {
      ...row,
      'body': encodeJsonColumn(row['body']),
    };

Map<String, Object?> _commsProposalRow(Map<String, dynamic> row) => {
      ...row,
      'situation': encodeJsonColumn(row['situation']),
      'steer': encodeJsonColumn(row['steer']),
      'rules': encodeJsonColumn(row['rules']),
      'needs_human': encodeJsonColumn(row['needs_human']),
    };

Map<String, Object?> _messageRow(Map<String, dynamic> row) => {
      ...row,
      'is_ai_drafted': row['is_ai_drafted'] == true ? 1 : 0,
    };

Map<String, Object?> _reminderRow(Map<String, dynamic> row) => {
      ...row,
      'is_done': row['is_done'] == true ? 1 : 0,
    };

Map<String, Object?> _campaignShortlistRow(Map<String, dynamic> row) => {
      ...row,
      'price_basis_snapshot': encodeJsonColumn(row['price_basis_snapshot']),
    };

Map<String, Object?> _activityRow(Map<String, dynamic> row) => {
      ...row,
      'detail': encodeJsonColumn(row['detail']),
      // A row the server holds is, by definition, synced — including one this
      // machine wrote and is now reading back.
      'synced': 1,
    };

/// Removes one deleted row.
///
/// Every pulled table has its own tombstone trigger on the server, cascades
/// included — deleting a thread there fires a tombstone for each of its
/// messages too — so one tombstone is one row here, and nothing has to
/// re-derive a cascade. A `channel_state` tombstone removes only the typed-in
/// half; the channel itself (the pipeline's row) is archived through the
/// catalog, not through this table.
///
/// Not wrapped in a transaction: every caller is already inside one.
void applyTombstone(
  MirrorDatabase db, {
  required String table,
  required String rowId,
  SyncDiagnostics? log,
}) {
  switch (table) {
    case 'channel_state':
      db.executeSync('DELETE FROM channel_state WHERE channel_id = ?', [rowId]);
    case 'scratchpads':
      db.executeSync('DELETE FROM scratchpads WHERE user_id = ?', [rowId]);
    case 'deals':
    case 'brands':
    case 'outreach_threads':
    case 'outreach_messages':
    case 'email_templates':
    case 'follow_up_reminders':
    case 'writing_rules':
    case 'edit_conflicts':
    case 'profiles':
    case 'campaigns':
    case 'campaign_shortlist':
    case 'deliverables':
    case 'channel_rate_history':
    case 'sequences':
    case 'sequence_steps':
    case 'agency_settings':
    case 'comms_proposals':
      db.executeSync('DELETE FROM $table WHERE id = ?', [rowId]);
    default:
      // A table this version of the app does not pull. Skipped rather than
      // treated as an error: an old client should ignore news it has no use
      // for, not refuse to sync.
      log?.log(
        'pull.tombstone.unknown',
        'Ignoring a tombstone for the unmirrored table "$table".',
        level: SyncLogLevel.warn,
        fields: {'table': table, 'rowId': rowId},
      );
  }
}
