import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/presence/presence_service.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// [buildPresenceLists] is the fix for a real bug: a reconnecting socket (a
/// dropped connection, a hot reload) used to leave a second, stale presence
/// entry for the same person sitting alongside the fresh one, which the
/// Dashboard showed as a duplicated "searching now" row frozen on whatever
/// keyword the dead connection last announced. These tests pin the
/// last-one-wins reduction that collapses that back to one entry per
/// `user_id`.
void main() {
  SinglePresenceState stateFor(List<Map<String, dynamic>> payloads) {
    return SinglePresenceState(
      key: 'gratovo:workspace',
      presences: [
        for (var i = 0; i < payloads.length; i++)
          Presence(presenceRef: 'ref-$i', payload: payloads[i]),
      ],
    );
  }

  Map<String, dynamic> searchingPayload(String userId, String keyword) => {
        'user_id': userId,
        'display_name': 'Mustafa',
        'color': '#3B82F6',
        'searching': {
          'keyword': keyword,
          'channels_found': 3,
          'started_at': DateTime.utc(2026, 1, 1).toIso8601String(),
        },
      };

  test('a single live entry passes through untouched', () {
    final result = buildPresenceLists([
      stateFor([searchingPayload('user-1', 'budget travel')]),
    ]);
    expect(result.searching, hasLength(1));
    expect(result.searching.single.status.keyword, 'budget travel');
  });

  test('two entries for the same user_id collapse to one, keeping the last',
      () {
    // Simulates a reconnect: the stale connection's last-known payload (an
    // old keyword) sits alongside the fresh one until the server notices the
    // old socket is dead.
    final result = buildPresenceLists([
      stateFor([
        searchingPayload('user-1', 'stale keyword'),
        searchingPayload('user-1', 'fresh keyword'),
      ]),
    ]);
    expect(result.searching, hasLength(1));
    expect(result.searching.single.status.keyword, 'fresh keyword');
  });

  test('duplicates split across separate keys/entries also collapse', () {
    final result = buildPresenceLists([
      stateFor([searchingPayload('user-1', 'stale keyword')]),
      stateFor([searchingPayload('user-1', 'fresh keyword')]),
    ]);
    expect(result.searching, hasLength(1));
    expect(result.searching.single.status.keyword, 'fresh keyword');
  });

  test('different users are kept separate', () {
    final result = buildPresenceLists([
      stateFor([
        searchingPayload('user-1', 'budget travel'),
        searchingPayload('user-2', 'ai tools'),
      ]),
    ]);
    expect(result.searching, hasLength(2));
    expect(result.searching.map((p) => p.userId),
        containsAll(['user-1', 'user-2']));
  });

  test('a malformed payload is skipped rather than crashing', () {
    final result = buildPresenceLists([
      stateFor([
        {'display_name': 'No user id'},
        searchingPayload('user-1', 'budget travel'),
      ]),
    ]);
    expect(result.searching, hasLength(1));
  });

  test('everyone with the app open appears in online, active or not', () {
    // user-1 is searching; user-2 has the app open but isn't doing anything
    // trackable (no editing target, no search) -- still counts as online.
    final result = buildPresenceLists([
      stateFor([
        searchingPayload('user-1', 'budget travel'),
        {
          'user_id': 'user-2',
          'display_name': 'Idle Person',
          'color': '#3B82F6'
        },
      ]),
    ]);
    expect(
        result.online.map((p) => p.userId), containsAll(['user-1', 'user-2']));
    expect(result.searching, hasLength(1));
  });

  test('duplicate online entries for the same user_id also collapse', () {
    final result = buildPresenceLists([
      stateFor([
        {'user_id': 'user-1', 'display_name': 'Stale', 'color': '#3B82F6'},
        {'user_id': 'user-1', 'display_name': 'Fresh', 'color': '#3B82F6'},
      ]),
    ]);
    expect(result.online, hasLength(1));
    expect(result.online.single.displayName, 'Fresh');
  });
}
