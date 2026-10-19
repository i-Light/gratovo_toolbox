import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';

SearchRun _run({
  SearchRunStatus status = SearchRunStatus.running,
  int channelsFound = 0,
  List<String> logLines = const [],
}) {
  return SearchRun(
    id: 'run_1',
    keywords: const ['tech review'],
    startedBy: 'This device',
    startedAt: DateTime(2026, 1, 1),
    status: status,
    channelsFound: channelsFound,
    logLines: logLines,
  );
}

void main() {
  group('SearchRun.copyWith', () {
    test('changes only the fields passed, leaving the rest untouched', () {
      final original = _run(channelsFound: 2);
      final updated = original.copyWith(channelsFound: 5);

      expect(updated.channelsFound, 5);
      expect(updated.id, original.id);
      expect(updated.keywords, original.keywords);
      expect(updated.startedBy, original.startedBy);
      expect(updated.startedAt, original.startedAt);
      expect(updated.status, original.status);
    });

    test(
        'appends a new log line without discarding prior ones when the '
        'caller passes the full accumulated list', () {
      final original = _run(logLines: const ['line 1']);
      final updated = original.copyWith(
        logLines: [...original.logLines, 'line 2'],
      );

      expect(updated.logLines, ['line 1', 'line 2']);
    });

    test('transitions status from running to completed and sets finishedAt',
        () {
      final original = _run(status: SearchRunStatus.running);
      final finishedAt = DateTime(2026, 1, 1, 1);
      final updated = original.copyWith(
        status: SearchRunStatus.completed,
        finishedAt: finishedAt,
        channelsFound: 12,
      );

      expect(updated.status, SearchRunStatus.completed);
      expect(updated.finishedAt, finishedAt);
      expect(updated.channelsFound, 12);
    });

    test('finishedAt stays null when never passed', () {
      final original = _run();
      final updated = original.copyWith(channelsFound: 1);

      expect(updated.finishedAt, isNull);
    });
  });
}
