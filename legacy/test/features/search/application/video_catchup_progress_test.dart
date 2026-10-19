import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/search/application/video_catchup_controller.dart';

/// The contract between `search.py --catch-up-videos` and the panel that is now
/// the only thing in the app able to say the sweep exists. Pinned for the same
/// reason `search_progress_parser_test.dart` pins the search lines: if the
/// shape drifts, nothing errors — the panel simply sits at "Counting how many
/// channels are still missing videos…" for an hour, which is the exact failure
/// this was built to end.
void main() {
  group('catchUpProgress', () {
    test('reads the done/total pair', () {
      final progress = catchUpProgress('[catchup] done=120 total=5336');
      expect(progress?.done, 120);
      expect(progress?.total, 5336);
    });

    test('reads the opening line, before anything has been worked', () {
      expect(catchUpProgress('[catchup] done=0 total=5336')?.done, 0);
    });

    test('tolerates the whitespace a line splitter may leave', () {
      expect(catchUpProgress('  [catchup] done=1 total=2  ')?.total, 2);
    });

    test('an ordinary log line carries no progress', () {
      expect(catchUpProgress('Pushed: {channels: 50}'), isNull);
      expect(catchUpProgress('[step] Backfill: @someone'), isNull);
    });
  });

  group('catchUpIoProgress', () {
    test('reads the within-batch scanned/fetched pair', () {
      final io =
          catchUpIoProgress('[catchup-io] scanned=40 fetched=12 batch=200');
      expect(io?.scanned, 40);
      expect(io?.fetched, 12);
    });

    test('tolerates the whitespace a line splitter may leave', () {
      expect(
        catchUpIoProgress('  [catchup-io] scanned=1 fetched=0 batch=25  ')
            ?.scanned,
        1,
      );
    });

    test('the sparse [catchup] line and ordinary output carry none', () {
      expect(catchUpIoProgress('[catchup] done=120 total=5336'), isNull);
      expect(catchUpIoProgress('[step] Backfill: @someone'), isNull);
    });
  });

  group('catchUpHandle', () {
    test('reads the channel being worked', () {
      expect(catchUpHandle('[step] Backfill: @someone'), '@someone');
    });

    test('ignores the other step lines the sweep prints', () {
      expect(
        catchUpHandle('[step] Backfilling videos for 250 channel(s) '
            'still missing them (backlog: 5336)...'),
        isNull,
      );
      expect(
          catchUpHandle('[step] Fetching details for 50 video(s)...'), isNull);
    });
  });

  group('VideoCatchUpState', () {
    test('has nothing to show before a pass has started', () {
      const idle = VideoCatchUpState(status: VideoCatchUpStatus.idle);
      expect(idle.hasProgressToShow, isFalse);
      const unavailable =
          VideoCatchUpState(status: VideoCatchUpStatus.unavailable);
      expect(unavailable.hasProgressToShow, isFalse);
    });

    test('has something to show once a pass has run', () {
      final done = VideoCatchUpState(
        status: VideoCatchUpStatus.done,
        startedAt: DateTime.now(),
        channelsDone: 900,
      );
      expect(done.hasProgressToShow, isTrue);
    });

    test('the bar stays indeterminate until the total is known', () {
      final starting = VideoCatchUpState(
        status: VideoCatchUpStatus.running,
        startedAt: DateTime.now(),
      );
      expect(starting.fraction, isNull);
    });

    test('the bar tracks channels, which is what the sweep counts', () {
      final running = VideoCatchUpState(
        status: VideoCatchUpStatus.running,
        startedAt: DateTime.now(),
        channelsDone: 25,
        backlogTotal: 100,
      );
      expect(running.fraction, 0.25);
    });

    test('the two layers add the current batch onto the [catchup] base', () {
      final running = VideoCatchUpState(
        status: VideoCatchUpStatus.running,
        startedAt: DateTime.now(),
        channelsDone: 200,
        backlogTotal: 1000,
        scannedInBatch: 50,
        fetchedInBatch: 20,
      );
      // Lighter fill: 200 finished + 50 read this batch.
      expect(running.readingUploadsFraction, 0.25);
      // Solid fill: 200 finished + 20 actually fetched this batch, and it
      // never runs ahead of the lighter one.
      expect(running.fraction, 0.22);
      expect(running.fraction! <= running.readingUploadsFraction!, isTrue);
    });

    test('the headline counts add the current batch onto the [catchup] base',
        () {
      const running = VideoCatchUpState(
        status: VideoCatchUpStatus.running,
        channelsDone: 200,
        backlogTotal: 1000,
        scannedInBatch: 50,
        fetchedInBatch: 20,
      );
      // What the panel headline shows: finished batches + this batch so far,
      // so both numbers move every channel rather than once per outer batch.
      expect(running.channelsRead, 250);
      expect(running.channelsSaved, 220);
      expect(running.channelsSaved <= running.channelsRead, isTrue);
    });

    test('the counts fall back to the [catchup] base before the first io line',
        () {
      const running = VideoCatchUpState(
        status: VideoCatchUpStatus.running,
        channelsDone: 200,
        backlogTotal: 1000,
      );
      expect(running.channelsRead, 200);
      expect(running.channelsSaved, 200);
    });

    test('both layers are indeterminate until the total is known', () {
      final starting = VideoCatchUpState(
        status: VideoCatchUpStatus.running,
        startedAt: DateTime.now(),
        scannedInBatch: 10,
      );
      expect(starting.fraction, isNull);
      expect(starting.readingUploadsFraction, isNull);
    });
  });

  group('catchUpSharing', () {
    test('reads the shared/total pair', () {
      final sharing = catchUpSharing('[sync-io] shared=25 of=5672');
      expect(sharing?.shared, 25);
      expect(sharing?.total, 5672);
    });

    test('the sweep\'s own lines carry none', () {
      expect(catchUpSharing('[catchup] done=50 total=428'), isNull);
      expect(
          catchUpSharing('[catchup-io] scanned=1 fetched=0 batch=50'), isNull);
      expect(catchUpSharing('Shared: 50 object(s) uploaded, 1 catalog op(s).'),
          isNull);
    });
  });

  // The transitions, driven by the exact lines a real run printed — the one
  // that sat on "Now reading @etnowswadesh" for twenty minutes while it
  // uploaded 5,672 objects. Every line is applied through the same function
  // the notifier uses, with a clock the test controls.
  group('applyCatchUpLine', () {
    final t0 = DateTime(2026, 9, 13, 14, 6, 55);
    late DateTime clock;
    DateTime now() => clock;

    VideoCatchUpState play(VideoCatchUpState state, List<String> lines) {
      for (final line in lines) {
        state = applyCatchUpLine(state, line, now: now);
      }
      return state;
    }

    setUp(() => clock = t0);

    test('a share replaces the handle of the batch just finished', () {
      var state = play(
        VideoCatchUpState(status: VideoCatchUpStatus.running, startedAt: t0),
        [
          '[catchup] done=0 total=428',
          '[step] Backfill: @etnowswadesh',
          '[catchup-io] scanned=50 fetched=50 batch=50',
          '[catchup] done=50 total=428',
        ],
      );
      // Batch over: the handle is not something the sweep is reading now.
      expect(state.currentHandle, isNull);
      expect(state.isSharing, isFalse);

      clock = t0.add(const Duration(minutes: 1));
      state = play(state, ['[sync-io] shared=0 of=5672']);
      expect(state.isSharing, isTrue);
      expect(state.sharedObjects, 0);
      expect(state.sharingTotal, 5672);
      expect(state.currentHandle, isNull);
      // The read counts are untouched by the share.
      expect(state.channelsRead, 50);
      expect(state.channelsSaved, 50);

      state = play(state, ['[sync-io] shared=25 of=5672']);
      expect(state.sharedObjects, 25);
    });

    test('a stale handle does not survive into a share', () {
      // The pre-fix shape: the handle from the last channel of the batch,
      // still on screen while the upload runs.
      final state = play(
        VideoCatchUpState(
          status: VideoCatchUpStatus.running,
          startedAt: t0,
          currentHandle: '@etnowswadesh',
        ),
        ['[sync-io] shared=0 of=5672'],
      );
      expect(state.currentHandle, isNull);
    });

    test('the next reading line ends the share and banks its time', () {
      var state = play(
        VideoCatchUpState(status: VideoCatchUpStatus.running, startedAt: t0),
        ['[catchup] done=50 total=428'],
      );
      clock = t0.add(const Duration(minutes: 1));
      state = play(state, ['[sync-io] shared=0 of=5672']);
      clock = t0.add(const Duration(minutes: 21));
      state = play(state, [
        '[sync-io] shared=5672 of=5672',
        '[step] Backfill: @next',
      ]);
      expect(state.isSharing, isFalse);
      expect(state.sharedObjects, isNull);
      expect(state.currentHandle, '@next');
      expect(state.spentSharing, const Duration(minutes: 20));
      // 21 minutes old, 20 of them uploading: one minute of reading.
      expect(state.readingElapsed(clock), const Duration(minutes: 1));
    });

    test('reading time excludes a share still in progress', () {
      var state = play(
        VideoCatchUpState(status: VideoCatchUpStatus.running, startedAt: t0),
        ['[catchup] done=50 total=428'],
      );
      clock = t0.add(const Duration(minutes: 1));
      state = play(state, ['[sync-io] shared=0 of=5672']);
      clock = t0.add(const Duration(minutes: 11));
      expect(state.readingElapsed(clock), const Duration(minutes: 1));
    });

    test('a second share in one pass adds to the first', () {
      var state =
          VideoCatchUpState(status: VideoCatchUpStatus.running, startedAt: t0);
      clock = t0.add(const Duration(minutes: 1));
      state = play(state, ['[sync-io] shared=0 of=50']);
      clock = t0.add(const Duration(minutes: 2));
      state = play(state, ['[catchup-io] scanned=1 fetched=0 batch=50']);
      clock = t0.add(const Duration(minutes: 3));
      state = play(state, ['[sync-io] shared=0 of=50']);
      clock = t0.add(const Duration(minutes: 5));
      state = play(state, ['[catchup-io] scanned=1 fetched=0 batch=50']);
      expect(state.spentSharing, const Duration(minutes: 3));
      expect(state.readingElapsed(clock), const Duration(minutes: 2));
    });

    test('a line that carries nothing returns the very same state', () {
      final state =
          VideoCatchUpState(status: VideoCatchUpStatus.running, startedAt: t0);
      expect(identical(applyCatchUpLine(state, '[step] Pacing 1.1s...'), state),
          isTrue);
      expect(identical(applyCatchUpLine(state, 'Shared: 1 object(s).'), state),
          isTrue);
    });

    test('a line that carries nothing does not end a share', () {
      var state =
          VideoCatchUpState(status: VideoCatchUpStatus.running, startedAt: t0);
      state = play(state, [
        '[sync-io] shared=0 of=5672',
        '[sync] upload of UC_x failed (timeout); will retry.',
      ]);
      expect(state.isSharing, isTrue);
    });
  });
}
