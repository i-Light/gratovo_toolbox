@Tags(['live'])
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_puller.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Does the *Dart* client hang on the page that Python fetches in 0.4 s?
///
/// The mirror timed out on one `channels` page in five consecutive sessions,
/// always at exactly its budget, always at the same cursor. Everything else has
/// been ruled out by measurement rather than argument:
///
///   * the server plans and runs that query in 5 ms (bitmap index scan),
///   * its RLS policy is a column-free `is_authorized()`, so a one-time filter,
///   * the URL postgrest-dart builds is well-formed and the cursor survives it
///     intact (see mirror_page_request_test.dart, which captures it),
///   * and the byte-for-byte identical request, issued from this machine over
///     plain `http.client`, returns 240 kB in 0.4 s, nine runs out of nine.
///
/// That leaves one untested component: the Dart HTTP stack the app actually
/// uses -- `package:http` under postgrest 2.9.1, whose `AbortableRequest` is
/// custom streaming machinery sitting exactly where the hang occurs. This runs
/// the real thing against the real project and times it.
///
/// Inert unless explicitly switched on, because it talks to the real project
/// with the real service key and no ordinary `flutter test` run should reach
/// production. A tag alone would not do it — tags exclude nothing without a
/// `dart_test.yaml` to say so, and this test quietly ran on the network the
/// first time the suite was executed. So it is gated on an environment
/// variable as well, which cannot be switched on by accident:
///
///     GRATOVO_LIVE_PROBE=1 flutter test --tags live \
///       test/core/sync/mirror_live_page_probe_test.dart
///
/// Credentials are read out of `data/.env` here, the same file the pipeline
/// reads, and are never printed.
void main() {
  final env = _readEnv();
  final url = env['SUPABASE_URL']?.trim();
  final key =
      (env['SUPABASE_SERVICE_KEY'] ?? env['SUPABASE_SERVICE_ROLE_KEY'])?.trim();
  final enabled = Platform.environment['GRATOVO_LIVE_PROBE'] == '1';

  test('the Dart client fetches the page the mirror hangs on', () async {
    final client = SupabaseClient(url!, key!);
    addTearDown(client.dispose);

    const cursor = '2026-09-05T01:13:48.524285+00:00';
    final cursorKey = encodeCursorKey(['UCw_LFe2pS8x3NyipGNJgeEA']);
    final filter = buildKeysetFilter(
      cursorColumn: 'updated_at',
      keyColumns: const ['channel_id'],
      cursor: cursor,
      key: cursorKey,
    );

    // The mirror's own column list, verbatim -- the wide one, because the
    // description and jsonb columns are most of the 240 kB.
    const columns = 'channel_id,handle,name,description,profile_picture,banner,'
        'subscribers,country,link,first_seen_at,last_fetched_at,notes,'
        'relevance_criteria,provided_data,vetting_status,pipeline_stage,'
        'contact_attempts,channel_tags,contacts,last_deal_at,archive_due_at,'
        'last_edited_by_name,videos_last_30,median_views_last_30,latest_upload_at,'
        'updated_at';

    // Three rounds: one slow request is weather, three is a fault. The app
    // retried too, and every retry failed the same way.
    for (var round = 1; round <= 3; round++) {
      final started = DateTime.now();
      final rows = await client
          .from('channels')
          .select(columns)
          .or(filter)
          .order('updated_at', ascending: true)
          .order('channel_id', ascending: true)
          .limit(500);
      final elapsed = DateTime.now().difference(started);

      // ignore: avoid_print
      print(
          'round $round: ${rows.length} rows in ${elapsed.inMilliseconds} ms');

      expect(
        elapsed.inSeconds,
        lessThan(20),
        reason: 'Python fetches this exact page in 0.4 s; if the Dart client '
            'takes tens of seconds, the fault is in the client stack',
      );
    }
  },
      timeout: const Timeout(Duration(minutes: 4)),
      skip: !enabled
          ? 'set GRATOVO_LIVE_PROBE=1 to run this against the real project'
          : (url == null || url.isEmpty || key == null || key.isEmpty)
              ? 'data/.env has no Supabase credentials on this machine'
              : false);
}

/// The same minimal parser `pipeline/gratovo/config.py` uses, so a value quoted
/// in the file is read the same way on both sides.
Map<String, String> _readEnv() {
  final file = File('data/.env');
  if (!file.existsSync()) return const {};
  final values = <String, String>{};
  for (var line in file.readAsLinesSync()) {
    line = line.trim();
    if (line.isEmpty || line.startsWith('#') || !line.contains('=')) continue;
    final at = line.indexOf('=');
    values[line.substring(0, at).trim()] =
        line.substring(at + 1).trim().replaceAll('"', '').replaceAll("'", '');
  }
  return values;
}
