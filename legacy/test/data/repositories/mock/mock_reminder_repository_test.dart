import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_reminder_repository.dart';

void main() {
  group('MockReminderRepository', () {
    test('getUpcoming returns not-done reminders soonest first', () async {
      final repo = MockReminderRepository();
      final upcoming = await repo.getUpcoming();

      expect(upcoming, isNotEmpty);
      expect(upcoming.every((r) => !r.isDone), isTrue);
      for (var i = 1; i < upcoming.length; i++) {
        expect(
          upcoming[i].dueAt.isBefore(upcoming[i - 1].dueAt),
          isFalse,
        );
      }
    });

    test('getForInfluencer returns only that influencer\'s open reminders',
        () async {
      final repo = MockReminderRepository();
      final list = await repo.getForInfluencer('inf_001');

      expect(list, isNotEmpty);
      expect(list.every((r) => r.influencerId == 'inf_001'), isTrue);
      expect(list.every((r) => !r.isDone), isTrue);
    });

    test('create assigns an id and the reminder then shows up', () async {
      final repo = MockReminderRepository();
      final before = await repo.getForInfluencer('inf_042');
      expect(before, isEmpty);

      final created = await repo.create(
        FollowUpReminder(
          id: '',
          title: 'Follow up with @NewChannel',
          dueAt: DateTime.now().add(const Duration(days: 4)),
          kind: ReminderKind.followUp,
          influencerId: 'inf_042',
        ),
      );

      expect(created.id, isNotEmpty);
      final after = await repo.getForInfluencer('inf_042');
      expect(after.map((r) => r.id), contains(created.id));
    });

    test('update replaces the mutable fields by id', () async {
      final repo = MockReminderRepository();
      final created = await repo.create(
        FollowUpReminder(
          id: '',
          title: 'draft',
          dueAt: DateTime.now().add(const Duration(days: 1)),
          kind: ReminderKind.followUp,
          influencerId: 'inf_050',
        ),
      );

      final moved = DateTime.now().add(const Duration(days: 9));
      await repo.update(created.copyWith(title: 'final', dueAt: moved));

      final reloaded = (await repo.getForInfluencer('inf_050')).singleWhere(
        (r) => r.id == created.id,
      );
      expect(reloaded.title, 'final');
      expect(reloaded.dueAt, moved);
    });

    test('complete drops the reminder from the open lists', () async {
      final repo = MockReminderRepository();
      final created = await repo.create(
        FollowUpReminder(
          id: '',
          title: 'one-off',
          dueAt: DateTime.now().add(const Duration(days: 2)),
          kind: ReminderKind.followUp,
          influencerId: 'inf_060',
        ),
      );

      await repo.complete(created.id);

      expect(await repo.getForInfluencer('inf_060'), isEmpty);
      expect(
        (await repo.getUpcoming()).map((r) => r.id),
        isNot(contains(created.id)),
      );
    });

    test('completeForInfluencer clears every open reminder for that influencer',
        () async {
      final repo = MockReminderRepository();
      for (var i = 0; i < 3; i++) {
        await repo.create(
          FollowUpReminder(
            id: '',
            title: 'chase $i',
            dueAt: DateTime.now().add(Duration(days: i + 1)),
            kind: ReminderKind.followUp,
            influencerId: 'inf_070',
          ),
        );
      }
      expect((await repo.getForInfluencer('inf_070')).length, 3);

      await repo.completeForInfluencer('inf_070');

      expect(await repo.getForInfluencer('inf_070'), isEmpty);
    });
  });
}
