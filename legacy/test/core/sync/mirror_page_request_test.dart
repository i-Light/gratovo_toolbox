import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/sync/mirror_puller.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// What the page request actually looks like on the wire.
///
/// The mirror spent five sessions timing out on one `channels` page while the
/// identical query, issued from the same machine with the same filter, came
/// back in half a second. Everything server-side was cleared — the plan is a
/// 5 ms bitmap index scan and the RLS policy is a one-time filter — which left
/// only the possibility that what the app sends is not what we think it sends.
///
/// So this pins it. A real [SupabaseClient] against a loopback server that
/// records the request line, exercising the same builder chain
/// `MirrorPuller._pageQuery` uses, with the cursor the mirror was actually
/// stuck on.
void main() {
  late HttpServer server;
  late List<String> requests;

  setUp(() async {
    requests = [];
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      requests.add(request.uri.toString());
      request.response
        ..statusCode = 200
        ..headers.contentType = ContentType.json
        ..write('[]');
      await request.response.close();
    });
  });

  tearDown(() => server.close(force: true));

  test('the channels page request is the query we think it is', () async {
    final client = SupabaseClient(
      'http://127.0.0.1:${server.port}',
      'test-anon-key',
    );
    addTearDown(client.dispose);

    // The exact position the mirror was wedged at, read out of _sync_meta.
    const cursor = '2026-09-05T01:13:48.524285+00:00';
    final key = encodeCursorKey(['UCw_LFe2pS8x3NyipGNJgeEA']);

    final filter = buildKeysetFilter(
      cursorColumn: 'updated_at',
      keyColumns: const ['channel_id'],
      cursor: cursor,
      key: key,
    );

    await client
        .from('channels')
        .select('channel_id,handle,name,description,updated_at')
        .or(filter)
        .order('updated_at', ascending: true)
        .order('channel_id', ascending: true)
        .limit(500);

    expect(requests, hasLength(1));
    final query = Uri.parse('http://x${requests.single}').queryParameters;

    // The timestamp must survive encoding intact. A literal `+` in a query
    // string decodes back to a space, which turns the cursor into an invalid
    // timestamp: PostgREST answers 400 and the page never arrives. Easy to get
    // wrong -- the first draft of the external probe that cleared the server of
    // this whole affair made exactly this mistake and had to be corrected
    // before it measured anything real.
    expect(
      query['or'],
      '(updated_at.gt."$cursor",'
      'and(updated_at.eq."$cursor",'
      'channel_id.gt."UCw_LFe2pS8x3NyipGNJgeEA"))',
      reason: 'the cursor must arrive at the server unmangled',
    );

    // postgrest-dart appends `.nullslast` to every order term. Harmless for an
    // ascending sort, since that is already PostgreSQL's default, but it is a
    // difference between what the app sends and what a hand-written probe
    // sends -- and reproducing a hang means reproducing the request exactly.
    expect(
      query['order'],
      'updated_at.asc.nullslast,channel_id.asc.nullslast',
    );
    expect(query['limit'], '500');
  });
}
