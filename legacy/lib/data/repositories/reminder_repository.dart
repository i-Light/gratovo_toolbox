import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';

/// How the UI reads and manages follow-up / deadline reminders. See
/// influencer_repository.dart's doc comment for the mock/Supabase swap
/// pattern this follows.
///
/// The Outreach page is where these get created and resolved day to day; the
/// Dashboard only reads [getUpcoming].
abstract class ReminderRepository {
  /// Not-yet-done reminders, soonest due first.
  Future<List<FollowUpReminder>> getUpcoming();

  /// How many reminders were scheduled (created) at or after [since] —
  /// the Dashboard's "scheduled today" stat. Counts every kind, done or not.
  Future<int> countCreatedSince(DateTime since);

  /// Open (not-done) reminders for one influencer, soonest due first.
  Future<List<FollowUpReminder>> getForInfluencer(String influencerId);

  /// Creates a reminder and returns the stored record with its id. The
  /// repository owns id generation; pass [FollowUpReminder.id] as `''`.
  Future<FollowUpReminder> create(FollowUpReminder reminder);

  /// Updates the mutable fields (title, dueAt, kind, isDone) of an existing
  /// reminder, matched by [FollowUpReminder.id].
  Future<void> update(FollowUpReminder reminder);

  /// Marks one reminder done.
  Future<void> complete(String id);

  /// Marks every open reminder for an influencer done — used when a reply
  /// lands and the outstanding "chase them" nudges no longer apply.
  Future<void> completeForInfluencer(String influencerId);
}
