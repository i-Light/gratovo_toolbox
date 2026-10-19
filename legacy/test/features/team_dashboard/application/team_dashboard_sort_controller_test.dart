import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_models.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_sort_controller.dart';

void main() {
  TeamDashboardRow row({
    required String id,
    required String name,
    int messagesSent = 0,
    int repliesReceived = 0,
    Duration? medianFirstResponseTime,
  }) =>
      TeamDashboardRow(
        member: TeamDashboardMember(id: id, name: name),
        messagesSent: messagesSent,
        repliesReceived: repliesReceived,
        medianFirstResponseTime: medianFirstResponseTime,
      );

  group('sortTeamDashboardRows', () {
    final rows = [
      row(id: 'b', name: 'Bilal', messagesSent: 5, repliesReceived: 1),
      row(
        id: 'a',
        name: 'Amira',
        messagesSent: 10,
        repliesReceived: 5,
        medianFirstResponseTime: const Duration(hours: 1),
      ),
      // No messages sent at all -> null reply rate.
      row(id: 'c', name: 'Cara'),
    ];

    test('sorts by name ascending by default', () {
      final sorted = sortTeamDashboardRows(
        rows,
        const TeamDashboardSort(
          column: TeamDashboardSortColumn.member,
          ascending: true,
        ),
      );
      expect(sorted.map((r) => r.member.name), ['Amira', 'Bilal', 'Cara']);
    });

    test('sorts by messages sent, either direction', () {
      final asc = sortTeamDashboardRows(
        rows,
        const TeamDashboardSort(
          column: TeamDashboardSortColumn.messagesSent,
          ascending: true,
        ),
      );
      expect(asc.map((r) => r.member.name), ['Cara', 'Bilal', 'Amira']);

      final desc = sortTeamDashboardRows(
        rows,
        const TeamDashboardSort(
          column: TeamDashboardSortColumn.messagesSent,
          ascending: false,
        ),
      );
      expect(desc.map((r) => r.member.name), ['Amira', 'Bilal', 'Cara']);
    });

    test('a null reply rate always sorts last, in both directions', () {
      final asc = sortTeamDashboardRows(
        rows,
        const TeamDashboardSort(
          column: TeamDashboardSortColumn.replyRate,
          ascending: true,
        ),
      );
      expect(asc.last.member.name, 'Cara');

      final desc = sortTeamDashboardRows(
        rows,
        const TeamDashboardSort(
          column: TeamDashboardSortColumn.replyRate,
          ascending: false,
        ),
      );
      expect(desc.last.member.name, 'Cara');
    });

    test('a null median response time always sorts last too', () {
      final desc = sortTeamDashboardRows(
        rows,
        const TeamDashboardSort(
          column: TeamDashboardSortColumn.medianFirstResponseTime,
          ascending: false,
        ),
      );
      // Only Amira has a value; Bilal and Cara (both null) trail her.
      expect(desc.first.member.name, 'Amira');
      expect(desc.last.member.name.isNotEmpty, isTrue);
      expect(
          desc.sublist(1).map((r) => r.medianFirstResponseTime), [null, null]);
    });
  });

  group('TeamDashboardSort.toggled', () {
    test('switching to a new numeric column defaults to descending', () {
      const current = TeamDashboardSort(
        column: TeamDashboardSortColumn.member,
        ascending: true,
      );
      final toggled = current.toggled(TeamDashboardSortColumn.messagesSent);
      expect(toggled.column, TeamDashboardSortColumn.messagesSent);
      expect(toggled.ascending, isFalse);
    });

    test('switching to the member column defaults to ascending', () {
      const current = TeamDashboardSort(
        column: TeamDashboardSortColumn.messagesSent,
        ascending: false,
      );
      final toggled = current.toggled(TeamDashboardSortColumn.member);
      expect(toggled.ascending, isTrue);
    });

    test('tapping the active column flips direction', () {
      const current = TeamDashboardSort(
        column: TeamDashboardSortColumn.messagesSent,
        ascending: false,
      );
      final toggled = current.toggled(TeamDashboardSortColumn.messagesSent);
      expect(toggled.column, TeamDashboardSortColumn.messagesSent);
      expect(toggled.ascending, isTrue);
    });
  });
}
