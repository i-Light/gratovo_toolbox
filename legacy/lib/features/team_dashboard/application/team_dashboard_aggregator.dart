import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/features/team_dashboard/application/team_dashboard_models.dart';

/// Monday 00:00 **UTC** of the week [date] falls in. [date] is converted to
/// UTC first and the result is always built with [DateTime.utc] — never the
/// local-zone [DateTime.new] constructor, which would silently reinterpret
/// the same year/month/day as local midnight and shift the boundary by
/// whatever offset the machine running this happens to be in. See
/// `team_dashboard_stats_provider.dart`'s [SelectedTeamDashboardWeekNotifier]
/// doc comment for why weeks are UTC-bucketed rather than display-zone.
DateTime startOfWeek(DateTime date) {
  final utc = date.toUtc();
  final day = DateTime.utc(utc.year, utc.month, utc.day);
  return day.subtract(Duration(days: day.weekday - DateTime.monday));
}

/// The pure rollup at the heart of the Team Dashboard: every number on the
/// screen is computed here, from rows that already exist, and nothing is
/// written back anywhere.
///
/// ## Why this needs a message-to-actor match at all
///
/// `outreach_messages` (direction, at, templateId) has no sender column —
/// mirrored straight from `backend/schema.sql`, which never recorded one.
/// The only place an outbound send carries a person is `activity_log`'s
/// `emailSent` entries, written by `ActivityLogger.emailSent` in the same
/// call as `OutreachRepository.recordMessage` (see
/// `outreach_compose_controller.dart`'s `_recordOutbound`) — so the two rows
/// share a thread and a near-identical timestamp, close enough to pair by
/// nearest-time within [matchTolerance]. An outbound message with no nearby
/// `emailSent` entry is an automated follow-up send (`_recordAutoSend` in
/// `outreach_inbox_controller.dart` never logs one, because nobody clicked
/// anything) and is correctly left unattributed — it counts toward no one's
/// [TeamDashboardRow.messagesSent].
///
/// ## Why replies are attributed by adjacency, not by `activity_log`
///
/// `activity_log` also has a `replyReceived` action, but its actor is
/// whichever team member happened to be signed in on the machine whose
/// mailbox sweep caught the reply (`outreach_inbox_controller.dart`'s
/// `_applyReply`, run from `AppShell` regardless of who is looking) — that
/// is not the conversation's owner, so using it as "who this reply is for"
/// would misattribute most replies. Instead a reply is credited to whoever
/// sent the message immediately before it on the same thread, and a
/// response is timed from the reply immediately before it — both read
/// straight off `outreach_messages.at`, which (for an inbound row) is the
/// mailbox's own received time, not the sweep's discovery time.
///
/// ## What this deliberately does not attempt
///
/// Per-member deals-moved/closed/margin. `deals` has no owner column and no
/// `activity_log` entry is written for a stage change at all (see
/// `deal_detail_screen.dart` — it calls `DealRepository.updateStage`
/// directly). There is nothing in the data that says who moved a deal, so
/// [TeamDashboardDealSummary] is team-wide only; see its doc comment.
TeamDashboardStats computeTeamDashboardStats({
  required List<TeamDashboardMember> members,
  required List<OutreachMessage> messages,
  required List<ActivityLogEntry> emailSentLog,
  required List<Deal> deals,
  required DateTime weekStart,
  Duration matchTolerance = const Duration(minutes: 10),
}) {
  final weekEnd = weekStart.add(const Duration(days: 7));
  bool inWeek(DateTime at) => !at.isBefore(weekStart) && at.isBefore(weekEnd);

  // --- 1. Attribute every outbound message to a member, per thread --------

  final logsByThread = <String, List<ActivityLogEntry>>{};
  for (final entry in emailSentLog) {
    final threadId = entry.entityId;
    if (threadId == null || entry.actorId == null) continue;
    (logsByThread[threadId] ??= []).add(entry);
  }
  for (final list in logsByThread.values) {
    list.sort((a, b) => a.at.compareTo(b.at));
  }

  final messagesByThread = <String, List<OutreachMessage>>{};
  for (final message in messages) {
    (messagesByThread[message.threadId] ??= []).add(message);
  }
  for (final list in messagesByThread.values) {
    list.sort((a, b) => a.at.compareTo(b.at));
  }

  final attribution = <String, TeamDashboardMember>{}; // messageId -> member
  for (final entry in messagesByThread.entries) {
    final threadId = entry.key;
    final threadMessages = entry.value;
    final logs = logsByThread[threadId] ?? const [];
    final used = List<bool>.filled(logs.length, false);

    for (final message in threadMessages) {
      if (message.direction != MessageDirection.outbound) continue;
      var bestIndex = -1;
      var bestDiff = matchTolerance;
      for (var i = 0; i < logs.length; i++) {
        if (used[i]) continue;
        final diff = logs[i].at.difference(message.at).abs();
        if (diff <= bestDiff) {
          bestDiff = diff;
          bestIndex = i;
        }
      }
      if (bestIndex == -1) continue;
      used[bestIndex] = true;
      final log = logs[bestIndex];
      attribution[message.id] = TeamDashboardMember(
        id: log.actorId!,
        name: log.actorName,
      );
    }
  }

  // --- 2. Walk each thread's timeline, crediting sends/replies/response ---

  final roster = <String, TeamDashboardMember>{
    for (final member in members) member.id: member,
  };
  final sent = <String, int>{};
  final replies = <String, int>{};
  final responseTimes = <String, List<Duration>>{};

  void creditMember(TeamDashboardMember member) {
    roster.putIfAbsent(member.id, () => member);
  }

  for (final threadMessages in messagesByThread.values) {
    for (final message in threadMessages) {
      if (message.direction != MessageDirection.outbound) continue;
      final actor = attribution[message.id];
      if (actor == null || !inWeek(message.at)) continue;
      creditMember(actor);
      sent[actor.id] = (sent[actor.id] ?? 0) + 1;
    }

    for (var i = 0; i < threadMessages.length - 1; i++) {
      final current = threadMessages[i];
      final next = threadMessages[i + 1];

      if (current.direction == MessageDirection.outbound &&
          next.direction == MessageDirection.inbound) {
        final actor = attribution[current.id];
        if (actor != null && inWeek(next.at)) {
          creditMember(actor);
          replies[actor.id] = (replies[actor.id] ?? 0) + 1;
        }
      }

      if (current.direction == MessageDirection.inbound &&
          next.direction == MessageDirection.outbound) {
        final actor = attribution[next.id];
        if (actor != null && inWeek(next.at)) {
          creditMember(actor);
          (responseTimes[actor.id] ??= []).add(next.at.difference(current.at));
        }
      }
    }
  }

  final rows = roster.values.map((member) {
    return TeamDashboardRow(
      member: member,
      messagesSent: sent[member.id] ?? 0,
      repliesReceived: replies[member.id] ?? 0,
      medianFirstResponseTime: _median(responseTimes[member.id] ?? const []),
    );
  }).toList()
    ..sort(
      (a, b) => a.member.name.toLowerCase().compareTo(
            b.member.name.toLowerCase(),
          ),
    );

  // --- 3. Team-wide deal figures -------------------------------------------

  final closedThisWeek = deals.where(
    (d) => d.stage == DealStage.closed && inWeek(d.updatedAt),
  );
  final dealsClosed = closedThisWeek.length;
  final marginClosed =
      closedThisWeek.fold<double>(0, (sum, d) => sum + d.margin);

  return TeamDashboardStats(
    weekStart: weekStart,
    rows: rows,
    deals: TeamDashboardDealSummary(
      dealsClosed: dealsClosed,
      marginClosed: marginClosed,
    ),
  );
}

Duration? _median(List<Duration> values) {
  if (values.isEmpty) return null;
  final sorted = [...values]..sort();
  final mid = sorted.length ~/ 2;
  if (sorted.length.isOdd) return sorted[mid];
  final a = sorted[mid - 1].inMicroseconds;
  final b = sorted[mid].inMicroseconds;
  return Duration(microseconds: ((a + b) / 2).round());
}
