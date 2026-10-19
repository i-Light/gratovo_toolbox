// Mirror v4: the local half of backend/schema.sql's 1.4 block (the owner's
// decisions of 2026-10-18, docs/plans/decisions_build_plan.md step 2).
import 'dart:io';
import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_database.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/mirror_schema.dart';
import 'package:gratovo_toolbox/core/sync/mirror_tables.dart';
import 'package:gratovo_toolbox/data/repositories/edit_cas.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';
import 'package:sqlite3/sqlite3.dart';

import '../../support/temp_mirror.dart';

void main() {
  group('a file written by version 3', () {
    late String path;

    setUp(() {
      final directory =
          Directory.systemTemp.createTempSync('gratovo_mirror_v3');
      path = '${directory.path}${Platform.pathSeparator}'
          'v3_${Random().nextInt(1 << 32)}.db';
      // The shape a version-3 app (and a pipeline from before the sponsorship
      // columns) left behind: only the tables 1.4 widens, as they were.
      final old = sqlite3.open(path);
      old.execute('''
        CREATE TABLE _sync_meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO _sync_meta VALUES ('app_schema_version', '3');
        CREATE TABLE channels (
          channel_id TEXT PRIMARY KEY, handle TEXT NOT NULL, name TEXT,
          description TEXT, subscribers TEXT, profile_picture TEXT, banner TEXT,
          link TEXT, country TEXT, first_seen_at TEXT NOT NULL,
          last_fetched_at TEXT, last_fetch_status TEXT, videos_fetched_at TEXT,
          force_refetch INTEGER NOT NULL DEFAULT 0,
          videos_last_30 INTEGER NOT NULL DEFAULT 0, median_views_last_30 INTEGER,
          latest_upload_at TEXT, blob_uploaded_at TEXT, blob_version TEXT,
          blob_applied_version TEXT, blob_announced_version TEXT, announced_at TEXT
        );
        CREATE TABLE channel_state (
          channel_id TEXT PRIMARY KEY, handle TEXT, vetting_status TEXT,
          relevance_criteria TEXT, notes TEXT, pipeline_stage TEXT,
          channel_tags TEXT, contacts TEXT, provided_data TEXT,
          archive_due_at TEXT, last_deal_at TEXT, last_edited_by TEXT,
          last_edited_by_name TEXT, updated_at TEXT,
          owner_id TEXT, manual_engagement_rate REAL, manual_engagement_note TEXT,
          manual_engagement_updated_at TEXT
        );
        CREATE TABLE brands (
          id TEXT PRIMARY KEY, name TEXT, contact_name TEXT, contact_email TEXT,
          contact_phone TEXT, website TEXT, budget REAL, campaign_brief TEXT,
          preferred_criteria TEXT, notes TEXT, created_at TEXT, updated_at TEXT
        );
        CREATE TABLE deals (
          id TEXT PRIMARY KEY, brand_id TEXT, channel_id TEXT, stage TEXT,
          brand_price REAL, influencer_payout REAL, deliverables TEXT,
          deadline TEXT, contract_url TEXT, notes TEXT,
          working_days_estimate INTEGER, created_at TEXT, updated_at TEXT,
          campaign_id TEXT, owner_id TEXT, currency TEXT,
          brand_invoice_sent_at TEXT, brand_invoice_paid_at TEXT,
          creator_payout_due_at TEXT, creator_payout_paid_at TEXT,
          payment_method TEXT, payment_reference TEXT
        );
        CREATE TABLE deliverables (
          id TEXT PRIMARY KEY, deal_id TEXT, type TEXT, agreed_date TEXT,
          draft_received_date TEXT, approved_date TEXT, published_url TEXT,
          status TEXT, notes TEXT, sort_order INTEGER, created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE outreach_threads (
          id TEXT PRIMARY KEY, channel_id TEXT, deal_id TEXT, status TEXT,
          updated_at TEXT, owner_id TEXT
        );
        INSERT INTO channels (channel_id, handle, first_seen_at)
          VALUES ('UCold', '@old', 'T');
        INSERT INTO channel_state (channel_id, handle, notes)
          VALUES ('UCold', '@old', 'keep me');
        INSERT INTO deals (id, brand_id, channel_id, brand_price)
          VALUES ('d1', 'b1', 'UCold', 42);
      ''');
      old.close();
    });

    test('opens, gains every 1.4 column and keeps its data', () async {
      final db = MirrorDatabase.open(path);
      addTearDown(() => discardTempMirror(db));

      Future<Set<String>> columns(String table) async => {
            for (final row in await db.getAll('PRAGMA table_info($table)'))
              row['name']! as String,
          };

      expect(await columns('channel_state'),
          containsAll(['media_kit', 'creator_gender']));
      expect(
          await columns('brands'),
          containsAll([
            'category',
            'country',
            'contacts',
            'budget_currency',
            'source'
          ]));
      expect(
          await columns('deals'),
          containsAll([
            'payment_terms',
            'tracking_link',
            'creator_contract_url',
            'creator_contract_status',
            'creator_signed_at',
            'brand_contract_url',
            'brand_contract_status',
            'brand_signed_at',
          ]));
      expect(
          await columns('deliverables'),
          containsAll([
            'published_at',
            'report_views',
            'report_views_at',
            'report_clicks',
          ]));
      expect(await columns('outreach_threads'),
          containsAll(['brand_id', 'contact_email']));
      // The pipeline's derived columns the app now reads; either program can be
      // the first to open the file after an update, so both carry the ALTER.
      expect(await columns('channels'),
          containsAll(['sponsored_ratio', 'seen_brands', 'found_emails']));

      final kept = await db.getAll(
          'SELECT notes FROM influencer_channels WHERE channel_id = ?',
          ['UCold']);
      expect(kept.single['notes'], 'keep me');
      final deal = await db.getAll('SELECT brand_price FROM deals');
      expect(deal.single['brand_price'], 42);
      expect(db.readMeta(MirrorMetaKeys.schemaVersion), '4');
    });
  });

  group('a fresh file', () {
    late MirrorDatabase db;

    setUp(() => db = openTempMirror());
    tearDown(() => discardTempMirror(db));

    test('the influencer view carries the 1.4 channel facts', () async {
      db.executeSync(
        'INSERT INTO channels (channel_id, handle, first_seen_at, '
        'sponsored_ratio, seen_brands, found_emails) VALUES (?, ?, ?, ?, ?, ?)',
        ['UCa', '@a', 'T', 0.4, '["NordVPN"]', '["biz@a.com"]'],
      );
      db.executeSync(
        'INSERT INTO channel_state (channel_id, handle, media_kit, '
        'creator_gender) VALUES (?, ?, ?, ?)',
        ['UCa', '@a', '{"ageBand":"18-34"}', 'male'],
      );

      final row = (await db.getAll(
        'SELECT sponsored_ratio, seen_brands, found_emails, media_kit, '
        'creator_gender FROM influencer_channels',
      ))
          .single;
      expect(row['sponsored_ratio'], 0.4);
      expect(row['seen_brands'], '["NordVPN"]');
      expect(row['found_emails'], '["biz@a.com"]');
      expect(row['media_kit'], '{"ageBand":"18-34"}');
      expect(row['creator_gender'], 'male');
    });

    test('every pulled column exists in its local table', () async {
      // The puller inserts exactly `localColumns`; a column missing from the
      // DDL is a pull that fails on every pass.
      for (final table in mirrorTables) {
        final local = {
          for (final row in await db.getAll('PRAGMA table_info(${table.name})'))
            row['name']! as String,
        };
        expect(local, containsAll(table.localColumns), reason: table.name);
      }
    });

    test('the two new tables are pulled, wiped on re-sync and tombstoned',
        () async {
      final names = [for (final table in mirrorTables) table.name];
      expect(names, containsAll(['agency_settings', 'comms_proposals']));
      expect(kAppPulledTables,
          containsAll(['agency_settings', 'comms_proposals']));

      db.executeSync(
          "INSERT INTO agency_settings (id, body) VALUES ('agency', '{}')");
      db.executeSync(
          "INSERT INTO comms_proposals (id, channel_id, kind) VALUES ('p1', 'UCa', 'first')");
      applyTombstone(db, table: 'agency_settings', rowId: 'agency');
      applyTombstone(db, table: 'comms_proposals', rowId: 'p1');

      expect(await db.getAll('SELECT id FROM agency_settings'), isEmpty);
      expect(await db.getAll('SELECT id FROM comms_proposals'), isEmpty);
    });
  });

  group('server rows become local rows', () {
    MirrorTable spec(String name) =>
        mirrorTables.firstWhere((table) => table.name == name);

    test('the server sends every 1.4 column it now has', () {
      expect(spec('channel_state').remoteColumns,
          containsAll(['media_kit', 'creator_gender']));
      expect(
          spec('brands').remoteColumns,
          containsAll([
            'category',
            'country',
            'contacts',
            'budget_currency',
            'source'
          ]));
      expect(
          spec('deals').remoteColumns,
          containsAll([
            'payment_terms',
            'tracking_link',
            'creator_contract_url',
            'creator_contract_status',
            'creator_signed_at',
            'brand_contract_url',
            'brand_contract_status',
            'brand_signed_at',
          ]));
      expect(
          spec('deliverables').remoteColumns,
          containsAll([
            'published_at',
            'report_views',
            'report_views_at',
            'report_clicks'
          ]));
      expect(spec('outreach_threads').remoteColumns,
          containsAll(['brand_id', 'contact_email']));
    });

    test('jsonb columns are stored as JSON strings', () {
      final state = spec('channel_state').toLocal({
        'channel_id': 'UCa',
        'media_kit': {'ageBand': '18-34'},
      });
      expect(state['media_kit'], '{"ageBand":"18-34"}');

      final brand = spec('brands').toLocal({
        'id': 'b1',
        'contacts': [
          {'method': 'email', 'value': 'jack@brand.one'},
        ],
      });
      expect(
          brand['contacts'], '[{"method":"email","value":"jack@brand.one"}]');

      final agency = spec('agency_settings').toLocal({
        'id': 'agency',
        'body': {'name': 'Gratovo'},
        'updated_at': 'T',
      });
      expect(agency['body'], '{"name":"Gratovo"}');

      final proposal = spec('comms_proposals').toLocal({
        'id': 'p1',
        'situation': {'stage': 'first'},
        'steer': null,
        'rules': ['INF-FIRST-02'],
        'needs_human': <String>[],
      });
      expect(proposal['situation'], '{"stage":"first"}');
      expect(proposal['steer'], isNull);
      expect(proposal['rules'], '["INF-FIRST-02"]');
      expect(proposal['needs_human'], '[]');
    });
  });

  test('the media kit and the creator flag are editable channel fields', () {
    expect(
        kEditableChannelFields, containsAll(['media_kit', 'creator_gender']));
    // The media kit is JSON: an edit stores it locally as JSON text.
    expect(kLocalJsonColumns, contains('media_kit'));
    // A cleared flag is the same fact as no flag, like the other text fields.
    expect(canonicalEditValue('creator_gender', ''), isNull);
  });

  test('the new tables can be written through the outbox', () {
    expect(OutboxKind.rowTables,
        containsAll(['agency_settings', 'comms_proposals']));
    expect(OutboxKind.keyColumn('agency_settings'), 'id');
    expect(OutboxKind.keyColumn('comms_proposals'), 'id');
  });
}
