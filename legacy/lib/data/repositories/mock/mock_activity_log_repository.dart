import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/activity_log_repository.dart';

/// In-memory log, seeded so the Logs page has something to show before the
/// backend is reachable.
///
/// The seed deliberately includes an entry whose actor has no id — someone who
/// has since been deleted — and one recorded at `basic` by a person who now
/// holds `full`. Those are the two cases the whole feature exists for, and a
/// demo dataset that omits them lets a UI that handles them badly look fine.
class MockActivityLogRepository implements ActivityLogRepository {
  MockActivityLogRepository() {
    final now = DateTime.now();
    _entries.addAll([
      ActivityLogEntry(
        id: 'log_001',
        at: now.subtract(const Duration(minutes: 4)),
        actorId: 'user_amira',
        actorName: 'Amira',
        actorRole: AccessLevel.full,
        action: ActivityAction.tagsChanged,
        entityType: 'channel',
        entityId: 'inf_001',
        entityLabel: '@TechWithTaha',
        field: 'channel_tags',
        oldValue: 'tech',
        newValue: 'tech, reviews',
      ),
      ActivityLogEntry(
        id: 'log_002',
        at: now.subtract(const Duration(minutes: 26)),
        actorId: 'user_amira',
        actorName: 'Amira',
        actorRole: AccessLevel.full,
        action: ActivityAction.notesChanged,
        entityType: 'channel',
        entityId: 'inf_003',
        entityLabel: '@FitWithLayla',
        field: 'notes',
      ),
      ActivityLogEntry(
        id: 'log_003',
        at: now.subtract(const Duration(hours: 3)),
        actorId: 'user_omar',
        actorName: 'Omar',
        // Recorded while Omar still held `basic`, even though he may hold
        // `full` today. This is the snapshot doing its job.
        actorRole: AccessLevel.basic,
        action: ActivityAction.emailSent,
        entityType: 'thread',
        entityId: 'thread_002',
        entityLabel: '@DailyGrindProductivity',
      ),
      ActivityLogEntry(
        id: 'log_004',
        at: now.subtract(const Duration(days: 1, hours: 2)),
        actorId: 'user_omar',
        actorName: 'Omar',
        actorRole: AccessLevel.basic,
        action: ActivityAction.stageChanged,
        entityType: 'channel',
        entityId: 'inf_006',
        entityLabel: '@WanderlustWithSara',
        field: 'pipeline_stage',
        oldValue: 'new',
        newValue: 'contacted',
      ),
      ActivityLogEntry(
        id: 'log_005',
        at: now.subtract(const Duration(days: 6)),
        // No actor id: this account has been deleted. The entry survives.
        actorName: 'Former teammate',
        actorRole: AccessLevel.full,
        action: ActivityAction.vettingChanged,
        entityType: 'channel',
        entityId: 'inf_004',
        entityLabel: '@PixelPlaysGaming',
        field: 'vetting_status',
        oldValue: 'newlyFound',
        newValue: 'rejected',
      ),
      ActivityLogEntry(
        id: 'log_006',
        at: now.subtract(const Duration(days: 8)),
        actorId: 'user_amira',
        actorName: 'Amira',
        actorRole: AccessLevel.full,
        action: ActivityAction.searchStarted,
        entityType: 'run',
        entityLabel: '4 keywords',
        detail: const {'keywords': 4},
      ),
    ]);
  }

  final List<ActivityLogEntry> _entries = [];

  var _nextId = 7;

  @override
  Future<ActivityLogPage> getPage({
    required int offset,
    required int limit,
    ActivityLogQuery query = const ActivityLogQuery(),
  }) async {
    final matched = _entries.where((e) => _matches(e, query)).toList()
      ..sort((a, b) => b.at.compareTo(a.at));

    final start = offset.clamp(0, matched.length);
    final end = (offset + limit).clamp(0, matched.length);
    final items = matched.sublist(start, end);

    // "A full page came back", not "there are more rows" — the same contract
    // the Supabase implementation can actually honour. See
    // MockInfluencerRepository.getPage for why the mock must not answer the
    // better question.
    return ActivityLogPage(items: items, hasMore: items.length == limit);
  }

  bool _matches(ActivityLogEntry entry, ActivityLogQuery query) {
    final search = query.search?.trim().toLowerCase();
    if (search != null && search.isNotEmpty) {
      final haystack = '${entry.actorName} ${entry.entityLabel ?? ''} '
              '${entry.field ?? ''}'
          .toLowerCase();
      if (!haystack.contains(search)) return false;
    }
    if (query.actorId != null && entry.actorId != query.actorId) return false;
    if (query.actorName != null && entry.actorName != query.actorName) {
      return false;
    }
    if (query.action != null && entry.action != query.action) return false;
    if (query.entityType != null && entry.entityType != query.entityType) {
      return false;
    }
    if (query.entityId != null && entry.entityId != query.entityId) {
      return false;
    }
    if (query.from != null && entry.at.isBefore(query.from!)) return false;
    if (query.to != null && !entry.at.isBefore(query.to!)) return false;
    return true;
  }

  @override
  Future<List<ActivityActor>> getActors() async {
    final byKey = <String, ActivityActor>{};
    for (final entry in _entries) {
      byKey.putIfAbsent(
        entry.actorId ?? 'name:${entry.actorName}',
        () => ActivityActor(
          id: entry.actorId,
          name: entry.actorName,
          isDeleted: entry.actorId == null,
        ),
      );
    }
    return byKey.values.toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  }

  @override
  Future<void> record({
    required ActivityDraft draft,
    required String? actorId,
    required String actorName,
    required AccessLevel actorRole,
  }) async {
    _entries.insert(
      0,
      ActivityLogEntry(
        id: 'log_${(_nextId++).toString().padLeft(3, '0')}',
        at: DateTime.now(),
        actorId: actorId,
        actorName: actorName,
        actorRole: actorRole,
        action: draft.action,
        entityType: draft.entityType,
        entityId: draft.entityId,
        entityLabel: draft.entityLabel,
        field: draft.field,
        oldValue: draft.oldValue,
        newValue: draft.newValue,
        detail: draft.detail,
      ),
    );
  }
}
