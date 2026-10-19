import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/activity_log_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Writes the history. One instance per signed-in identity.
///
/// Who acted is captured here, from the session, and never accepted as an
/// argument — a call site that could name its own actor is a call site that
/// could name the wrong one, and the value of a log is precisely that it
/// cannot be talked into recording the wrong name.
///
/// Every method returns void and fires the write off without awaiting it.
/// That is the deliberate shape: [ActivityLogRepository.record] swallows its
/// own failures, so there is nothing for a caller to handle, and making the
/// caller await would put a network round trip between a button press and the
/// UI updating for a write whose outcome does not change what the user sees.
class ActivityLogger {
  const ActivityLogger({
    required ActivityLogRepository repository,
    required String? actorId,
    required String actorName,
    required AccessLevel actorRole,
  })  : _repository = repository,
        _actorId = actorId,
        _actorName = actorName,
        _actorRole = actorRole;

  final ActivityLogRepository _repository;
  final String? _actorId;
  final String _actorName;
  final AccessLevel _actorRole;

  void record(ActivityDraft draft) {
    unawaited(_repository.record(
      draft: draft,
      actorId: _actorId,
      actorName: _actorName,
      actorRole: _actorRole,
    ));
  }

  // --- Channel actions -----------------------------------------------------
  //
  // Each takes the influencer rather than an id, because the entity LABEL has
  // to be snapshotted at the moment of the action and the influencer is the
  // only thing that knows it. A channel can be renamed, and "changed the tags
  // on UCa1b2c3..." is not a line anyone can read six months later.

  void channelTagsChanged(
    Influencer influencer, {
    required List<ChannelTag> before,
    required List<ChannelTag> after,
  }) {
    record(ActivityDraft(
      action: ActivityAction.tagsChanged,
      entityType: 'channel',
      entityId: influencer.id,
      entityLabel: influencer.handle,
      field: 'channel_tags',
      oldValue: _joined(before.map((t) => t.wire).toList()),
      newValue: _joined(after.map((t) => t.wire).toList()),
    ));
  }

  void channelStageChanged(
    Influencer influencer, {
    required PipelineStage before,
    required PipelineStage after,
  }) {
    record(ActivityDraft(
      action: ActivityAction.stageChanged,
      entityType: 'channel',
      entityId: influencer.id,
      entityLabel: influencer.handle,
      field: 'pipeline_stage',
      oldValue: before.wire,
      newValue: after.wire,
    ));
  }

  void channelVettingChanged(
    Influencer influencer, {
    required VettingStatus before,
    required VettingStatus after,
  }) {
    record(ActivityDraft(
      action: ActivityAction.vettingChanged,
      entityType: 'channel',
      entityId: influencer.id,
      entityLabel: influencer.handle,
      field: 'vetting_status',
      oldValue: before.name,
      newValue: after.name,
    ));
  }

  /// Notes record THAT they changed and by how much, never what they now say.
  ///
  /// Notes carry things said in confidence about a person — "always replies
  /// late", "audience skews too young" — and a log is read by more people, for
  /// longer, than the field it copies. Recording the length keeps the entry
  /// informative (an accidental wipe is visible as 400 characters becoming 0)
  /// without turning the history into a second, permanent copy of every
  /// private remark anyone has ever typed.
  void channelNotesChanged(
    Influencer influencer, {
    required String? before,
    required String after,
  }) {
    record(ActivityDraft(
      action: ActivityAction.notesChanged,
      entityType: 'channel',
      entityId: influencer.id,
      entityLabel: influencer.handle,
      field: 'notes',
      detail: {
        'lengthBefore': (before ?? '').trim().length,
        'lengthAfter': after.trim().length,
      },
    ));
  }

  /// Contacts record how many there are and which methods, never the
  /// addresses themselves — same reasoning as [channelNotesChanged], plus the
  /// email addresses in here are exactly the data the `basic` access level is
  /// built to withhold.
  void channelContactsChanged(
    Influencer influencer, {
    required List<InfluencerContact> before,
    required List<InfluencerContact> after,
  }) {
    record(ActivityDraft(
      action: ActivityAction.contactsChanged,
      entityType: 'channel',
      entityId: influencer.id,
      entityLabel: influencer.handle,
      field: 'contacts',
      oldValue: _contactSummary(before),
      newValue: _contactSummary(after),
    ));
  }

  void channelContactAttempt(Influencer influencer, {required int after}) {
    record(ActivityDraft(
      action: ActivityAction.contactAttempt,
      entityType: 'channel',
      entityId: influencer.id,
      entityLabel: influencer.handle,
      field: 'contact_attempts',
      oldValue: '${after - 1}',
      newValue: '$after',
    ));
  }

  void channelCreated({required String id, required String handle}) {
    record(ActivityDraft(
      action: ActivityAction.created,
      entityType: 'channel',
      entityId: id,
      entityLabel: handle,
    ));
  }

  void channelRelevanceCriteriaChanged(
    Influencer influencer, {
    required List<String> before,
    required List<String> after,
  }) {
    record(ActivityDraft(
      action: ActivityAction.updated,
      entityType: 'channel',
      entityId: influencer.id,
      entityLabel: influencer.handle,
      field: 'relevance_criteria',
      oldValue: _joined(before),
      newValue: _joined(after),
    ));
  }

  void channelProvidedDataChanged(
    Influencer influencer, {
    required int fieldCount,
  }) {
    record(ActivityDraft(
      action: ActivityAction.updated,
      entityType: 'channel',
      entityId: influencer.id,
      entityLabel: influencer.handle,
      field: 'provided_data',
      newValue: '$fieldCount',
    ));
  }

  void videosPulled(
    Influencer influencer, {
    required int months,
    required bool succeeded,
  }) {
    record(ActivityDraft(
      action: ActivityAction.videosPulled,
      entityType: 'channel',
      entityId: influencer.id,
      entityLabel: influencer.handle,
      detail: {'months': months, 'succeeded': succeeded},
    ));
  }

  // --- Everything else -----------------------------------------------------

  void searchStarted({required List<String> keywords}) {
    record(ActivityDraft(
      action: ActivityAction.searchStarted,
      entityType: 'run',
      // The keywords themselves, not just a count: which keywords a run was
      // started with is the one thing anyone ever wants to know afterwards,
      // and they are not sensitive.
      entityLabel: _joined(keywords),
      detail: {'keywords': keywords},
    ));
  }

  void emailSent({
    required String threadId,
    required String label,
    required String subject,
  }) {
    record(ActivityDraft(
      action: ActivityAction.emailSent,
      entityType: 'thread',
      entityId: threadId,
      entityLabel: label,
      // The subject line, not the body. The subject is what identifies which
      // message this was; the body is the sensitive part and stays where the
      // access rules already govern it.
      newValue: subject,
    ));
  }

  /// A reply the outreach mailbox found, logged by the app rather than a
  /// person. [label] is the channel handle; [subject] identifies which message
  /// it answered.
  void replyReceived({
    required String threadId,
    required String label,
    required String subject,
  }) {
    record(ActivityDraft(
      action: ActivityAction.replyReceived,
      entityType: 'thread',
      entityId: threadId,
      entityLabel: label,
      // The subject only, for the same reason emailSent records the subject
      // only: the body is the sensitive half and the access rules already
      // govern where it lives.
      newValue: subject,
    ));
  }

  /// "a, b, c", or an em dash when empty — a blank cell in a log column is
  /// ambiguous between "nothing" and "not recorded".
  static String _joined(List<String> values) =>
      values.isEmpty ? '—' : values.join(', ');

  static String _contactSummary(List<InfluencerContact> contacts) {
    if (contacts.isEmpty) return '—';
    final counts = <ContactMethod, int>{};
    for (final contact in contacts) {
      counts[contact.method] = (counts[contact.method] ?? 0) + 1;
    }
    return [
      for (final entry in counts.entries)
        entry.value == 1 ? entry.key.wire : '${entry.key.wire} x${entry.value}',
    ].join(', ');
  }
}

/// The logger bound to whoever is signed in right now.
///
/// Falls back to a name rather than refusing to log when there is no profile:
/// the two cases that produces are the mock-backed build and the brief window
/// before the profile row arrives, and in both of them a nameless entry is
/// still a better record than no entry.
final activityLoggerProvider = Provider<ActivityLogger>((ref) {
  final session = ref.watch(currentSessionProvider);
  final profile = ref.watch(currentProfileProvider).maybeWhen(
        data: (value) => value,
        orElse: () => null,
      );

  return ActivityLogger(
    repository: ref.watch(activityLogRepositoryProvider),
    actorId: profile?.id ?? session?.user.id,
    actorName: profile?.displayName ?? session?.user.email ?? 'Unknown',
    actorRole: profile?.accessLevel ?? AccessLevel.unauthorized,
  );
});
