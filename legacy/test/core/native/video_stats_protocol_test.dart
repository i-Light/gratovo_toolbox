// tools/video_stats.py's answer, read by the app (plan step 7).
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/video_stats_protocol.dart';

void main() {
  test('a good answer gives the video, its views and when', () {
    final result = parseVideoStats(
        '{"ok": true, "videoId": "dQw4w9WgXcQ", "views": 61234, '
        '"fetchedAt": "2026-11-17T09:30:00Z"}');

    expect(result.views, 61234);
    expect(result.videoId, 'dQw4w9WgXcQ');
    expect(result.fetchedAt, DateTime.utc(2026, 11, 17, 9, 30));
    expect(result.error, isNull);
  });

  test('a refusal carries its code and message', () {
    final result =
        parseVideoStats('{"ok": false, "error": {"code": "not_found", '
            '"message": "YouTube does not show that video."}}');

    expect(result.views, isNull);
    expect(result.error!.code, 'not_found');
    expect(result.error!.message, 'YouTube does not show that video.');
  });

  test('a crash with no JSON reports its last line', () {
    final result = parseVideoStats('Traceback (most recent call last):\n'
        '  File "x.py", line 1\n'
        'ModuleNotFoundError: No module named googleapiclient\n');

    expect(result.views, isNull);
    expect(result.error!.code, 'unavailable');
    expect(result.error!.message, contains('googleapiclient'));
  });
}
