import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/env_merge.dart';

void main() {
  const seed = '''
# ---- YouTube ----
YOUTUBE_API_KEY=build-key

# ---- R2 ----
R2_ACCOUNT_ID=acc
R2_ACCESS_KEY_ID=key
R2_SECRET_ACCESS_KEY=secret
R2_BUCKET=gratovo
SUPABASE_SERVICE_KEY=
WORKER_NAME=
''';

  test('parses assignments and skips comments', () {
    expect(parseEnv(seed), {
      'YOUTUBE_API_KEY': 'build-key',
      'R2_ACCOUNT_ID': 'acc',
      'R2_ACCESS_KEY_ID': 'key',
      'R2_SECRET_ACCESS_KEY': 'secret',
      'R2_BUCKET': 'gratovo',
      'SUPABASE_SERVICE_KEY': '',
      'WORKER_NAME': '',
    });
  });

  test('adds the keys the machine lacks and keeps every value it has', () {
    const local = '''
YOUTUBE_API_KEY=my-own-key
WORKER_NAME=laptop-b
R2_BUCKET=
''';
    final merged = mergeEnvText(local, seed, now: DateTime.utc(2026, 9, 13))!;
    final result = parseEnv(merged);
    expect(result['YOUTUBE_API_KEY'], 'my-own-key',
        reason: 'never overwritten');
    expect(result['WORKER_NAME'], 'laptop-b', reason: 'per-machine, kept');
    expect(result['R2_BUCKET'], 'gratovo', reason: 'empty locally: filled in');
    expect(result['R2_ACCOUNT_ID'], 'acc');
    expect(result['R2_SECRET_ACCESS_KEY'], 'secret');
    expect(result.containsKey('SUPABASE_SERVICE_KEY'), isFalse,
        reason: 'an empty seed value adds nothing');
    // The fill-in happened on the existing line; the additions are dated.
    expect(merged.split('\n'), containsAllInOrder(['R2_BUCKET=gratovo']));
    expect(merged, isNot(contains('R2_BUCKET=\n')));
    expect(
        merged,
        contains(
            '# ---- Added by the app from the installed build on 2026-09-13 ----'));
  });

  test('nothing to add leaves the file alone', () {
    expect(mergeEnvText(seed, seed), isNull);
    expect(mergeEnvText('R2_BUCKET=other\n', 'R2_BUCKET=gratovo\n'), isNull);
  });
}
