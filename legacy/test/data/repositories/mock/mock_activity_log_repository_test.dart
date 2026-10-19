import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_activity_log_repository.dart';

/// The two properties the whole feature exists for are that an entry survives
/// its actor's account being deleted, and that it records the authority held at
/// the time rather than the authority held now. Neither is visible in the
/// happy path, so both are asserted here directly.
void main() {
  group('reading', () {
    test('returns entries newest first', () async {
      final repository = MockActivityLogRepository();
      final page = await repository.getPage(offset: 0, limit: 50);

      final times = page.items.map((e) => e.at).toList();
      for (var i = 1; i < times.length; i++) {
        expect(
          times[i].isAfter(times[i - 1]),
          isFalse,
          reason: 'entry $i is newer than the one before it',
        );
      }
    });

    test('an entry whose account was deleted keeps its name and its facts',
        () async {
      final repository = MockActivityLogRepository();
      final page = await repository.getPage(offset: 0, limit: 50);
      final orphaned = page.items.where((e) => e.actorIsGone).toList();

      expect(orphaned, isNotEmpty,
          reason: 'the seed must cover the deleted-account case');
      final entry = orphaned.first;
      expect(entry.actorId, isNull);
      // The name is a snapshot, not a join, which is why it is still here.
      expect(entry.actorName, isNotEmpty);
      expect(entry.entityLabel, isNotNull);
      expect(entry.action, isNot(ActivityAction.unknown));
    });

    test('the recorded role is the one held at the time', () async {
      final repository = MockActivityLogRepository();
      final page = await repository.getPage(offset: 0, limit: 50);

      final omar = page.items.where((e) => e.actorName == 'Omar').toList();
      expect(omar, isNotEmpty);
      // Omar's entries are recorded at `basic`. Promoting him to `full` today
      // must not rewrite them — which is exactly what a live join to profiles
      // would do, and why actor_role is a copied value.
      expect(
        omar.every((e) => e.actorRole == AccessLevel.basic),
        isTrue,
      );
    });
  });

  group('filtering', () {
    test('by actor id', () async {
      final repository = MockActivityLogRepository();
      final page = await repository.getPage(
        offset: 0,
        limit: 50,
        query: const ActivityLogQuery(actorId: 'user_amira'),
      );

      expect(page.items, isNotEmpty);
      expect(page.items.every((e) => e.actorId == 'user_amira'), isTrue);
    });

    test('by action', () async {
      final repository = MockActivityLogRepository();
      final page = await repository.getPage(
        offset: 0,
        limit: 50,
        query: const ActivityLogQuery(action: ActivityAction.tagsChanged),
      );

      expect(page.items, isNotEmpty);
      expect(
        page.items.every((e) => e.action == ActivityAction.tagsChanged),
        isTrue,
      );
    });

    test('by entity, which is what a profile page asks for', () async {
      final repository = MockActivityLogRepository();
      final page = await repository.getPage(
        offset: 0,
        limit: 50,
        query:
            const ActivityLogQuery(entityType: 'channel', entityId: 'inf_001'),
      );

      expect(page.items, isNotEmpty);
      expect(
        page.items.every(
          (e) => e.entityType == 'channel' && e.entityId == 'inf_001',
        ),
        isTrue,
      );
    });

    test('the date range is half-open: `from` included, `to` excluded',
        () async {
      final repository = MockActivityLogRepository();
      final now = DateTime.now();
      final page = await repository.getPage(
        offset: 0,
        limit: 50,
        query: ActivityLogQuery(
          from: now.subtract(const Duration(hours: 1)),
          to: now.add(const Duration(minutes: 1)),
        ),
      );

      expect(page.items, isNotEmpty);
      expect(
        page.items.every(
          (e) =>
              !e.at.isBefore(now.subtract(const Duration(hours: 1))) &&
              e.at.isBefore(now.add(const Duration(minutes: 1))),
        ),
        isTrue,
      );
    });

    test(
        'free text searches the actor name, so a deleted account is still '
        'reachable', () async {
      // The actor dropdown filters on the id, which a deleted account no
      // longer has. The search box is the only way to their history, so it has
      // to work on the snapshotted name.
      final repository = MockActivityLogRepository();
      final page = await repository.getPage(
        offset: 0,
        limit: 50,
        query: const ActivityLogQuery(search: 'former'),
      );

      expect(page.items, isNotEmpty);
      expect(page.items.every((e) => e.actorIsGone), isTrue);
    });
  });

  group('paging', () {
    test('hasMore means "a full page came back", not "there are more rows"',
        () async {
      // The Supabase implementation cannot answer the second question without
      // a second count query over a table that only grows, so the shared
      // contract is the weaker one. The mock must not be better than
      // production here — a mock that pages differently is the one thing a
      // mock must never be.
      final repository = MockActivityLogRepository();
      final all = await repository.getPage(offset: 0, limit: 100);
      final total = all.items.length;

      final exact = await repository.getPage(offset: 0, limit: total);
      expect(exact.items, hasLength(total));
      expect(exact.hasMore, isTrue,
          reason: 'a full page always reports hasMore');

      final beyond = await repository.getPage(offset: total, limit: total);
      expect(beyond.items, isEmpty);
      expect(beyond.hasMore, isFalse);
    });

    test('pages without dropping or repeating an entry', () async {
      final repository = MockActivityLogRepository();
      final all = await repository.getPage(offset: 0, limit: 100);

      final first = await repository.getPage(offset: 0, limit: 2);
      final second = await repository.getPage(offset: 2, limit: 2);
      final ids = [
        ...first.items.map((e) => e.id),
        ...second.items.map((e) => e.id),
      ];

      expect(ids.toSet(), hasLength(ids.length));
      expect(ids, all.items.take(ids.length).map((e) => e.id).toList());
    });
  });

  group('appending', () {
    test('a recorded action becomes the newest entry', () async {
      final repository = MockActivityLogRepository();
      await repository.record(
        draft: const ActivityDraft(
          action: ActivityAction.stageChanged,
          entityType: 'channel',
          entityId: 'inf_009',
          entityLabel: '@NewlyAdded',
          field: 'pipeline_stage',
          oldValue: 'new',
          newValue: 'contacted',
        ),
        actorId: 'user_test',
        actorName: 'Tester',
        actorRole: AccessLevel.full,
      );

      final page = await repository.getPage(offset: 0, limit: 1);
      final entry = page.items.single;
      expect(entry.actorName, 'Tester');
      expect(entry.actorRole, AccessLevel.full);
      expect(entry.entityLabel, '@NewlyAdded');
      expect(entry.newValue, 'contacted');
    });

    test('an anonymous entry is recorded rather than refused', () async {
      // Reached when the profile row has not arrived yet. A nameless entry is
      // a smaller loss than a missing one.
      final repository = MockActivityLogRepository();
      await repository.record(
        draft: const ActivityDraft(
          action: ActivityAction.searchStarted,
          entityType: 'run',
        ),
        actorId: null,
        actorName: 'Unknown',
        actorRole: AccessLevel.unauthorized,
      );

      final page = await repository.getPage(offset: 0, limit: 1);
      expect(page.items.single.actorIsGone, isTrue);
    });
  });

  group('getActors', () {
    test('includes people whose account is gone, marked as such', () async {
      // Read from the log rather than from profiles, which is the whole point:
      // a deleted account has no profile row left but still has history.
      final repository = MockActivityLogRepository();
      final actors = await repository.getActors();

      expect(actors.where((a) => a.isDeleted), isNotEmpty);
      expect(
          actors.where((a) => a.isDeleted).every((a) => a.id == null), isTrue);
    });

    test('lists each person once and sorts them by name', () async {
      final repository = MockActivityLogRepository();
      final actors = await repository.getActors();

      final names = actors.map((a) => a.name).toList();
      expect(names.toSet(), hasLength(names.length));
      final sorted = [...names]
        ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
      expect(names, sorted);
    });
  });
}
