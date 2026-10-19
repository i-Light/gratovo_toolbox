import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/bulk_rejection.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_archive_repository.dart';

/// The half of a bulk clean that does not happen in the database.
///
/// An immediate clean is two different operations: one UPDATE that tags every
/// matched channel, and then the deletions — a row-by-row loop with a cascading
/// delete per channel, which at the sizes this tool exists for cannot finish
/// inside one PostgREST request's statement timeout. So the RPC hands the ids
/// back and the client deletes them in batches. What is worth pinning is the
/// batching itself: a loop that loses the last partial batch leaves channels
/// tagged, due and undeleted, and says nothing.
void main() {
  group('sweepBatches', () {
    test('covers every id exactly once, in order', () {
      final ids = [for (var i = 0; i < 250; i++) 'UC_$i'];
      final batches = MirrorArchiveRepository.sweepBatches(ids, size: 100);

      expect(batches.map((batch) => batch.length), [100, 100, 50]);
      expect(batches.expand((batch) => batch), ids);
    });

    test('an exact multiple produces no trailing empty request', () {
      final ids = [for (var i = 0; i < 200; i++) 'UC_$i'];
      expect(
        MirrorArchiveRepository.sweepBatches(ids, size: 100),
        hasLength(2),
      );
    });

    test('nothing to sweep is no requests at all', () {
      expect(MirrorArchiveRepository.sweepBatches(const []), isEmpty);
    });
  });

  group('BulkRejectionOutcome', () {
    test('reads the ids the RPC deferred to the client', () {
      final outcome = BulkRejectionOutcome.fromJson(const {
        'matched': 2,
        'tagged': 2,
        'archived': 0,
        'skipped_tagged': 1,
        'skipped_protected': 0,
        'skipped_unknown': 3,
        'pending_ids': ['UC_a', 'UC_b'],
      });

      expect(outcome.matched, 2);
      expect(outcome.pendingIds, ['UC_a', 'UC_b']);
    });

    test('a non-immediate clean carries no ids and needs none', () {
      // The column is null on every path but the deferred one, and a null that
      // becomes a crash here would break the ordinary tagging clean as well.
      final outcome = BulkRejectionOutcome.fromJson(const {
        'matched': 4,
        'tagged': 4,
        'archived': 0,
        'skipped_tagged': 0,
        'skipped_protected': 0,
        'skipped_unknown': 0,
        'pending_ids': null,
      });

      expect(outcome.pendingIds, isEmpty);
    });
  });

  test('a sweep that dies halfway says how far it got', () {
    // The tags are committed by then: the remaining channels are rejected and
    // past their archive date, so the nightly sweep finishes them. That is the
    // difference between an interrupted clean and one that never happened, and
    // it is the sentence the dialog shows.
    const failure = BulkSweepFailure(
      swept: 400,
      total: 1782,
      cause: 'canceling statement due to statement timeout',
    );

    expect(failure.toString(), contains('deleted 400'));
    expect(failure.toString(), contains('remaining 1382'));
    expect(failure.toString(), contains('statement timeout'));
  });
}
