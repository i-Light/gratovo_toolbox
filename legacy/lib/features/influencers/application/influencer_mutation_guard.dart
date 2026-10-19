import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/toast/toast_severity.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_filter_controller.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_page_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// What happened to one attempted mutation.
///
/// A returned value rather than a rethrown exception, for two reasons. Every
/// caller has to decide what to show either way, and a returned result makes
/// forgetting that a visible choice rather than a silent one — which is
/// exactly the bug this type was added to close. And the conflict layer adds a
/// third case carrying the competing server value, which an exception could
/// only smuggle.
sealed class MutationResult {
  const MutationResult();

  bool get succeeded => this is MutationApplied;
}

/// The write reached the server and the field now reads as intended.
///
/// Covers the three outcomes that are all successes from the caller's point of
/// view: the edit was written, it changed nothing, or the value was already
/// what was wanted because somebody independently chose the same thing.
final class MutationApplied extends MutationResult {
  const MutationApplied(this.outcome);

  final EditOutcome outcome;
}

/// The edit was composed against a value somebody else has since changed.
///
/// The column was NOT written. What the person wrote is held in an
/// `edit_conflicts` row — this record is now the only copy of it, which is why
/// the UI must send them somewhere they can see it rather than only saying
/// "couldn't save".
final class MutationConflicted extends MutationResult {
  const MutationConflicted();
}

/// The channel is gone — archived out from under the editor, most likely.
final class MutationMissing extends MutationResult {
  const MutationMissing();
}

/// The write was refused, or never arrived.
///
/// [error] is kept rather than swallowed. A permission refusal, a dropped
/// connection and a violated check constraint are three different situations
/// that deserve three different messages, and none of them can be told apart
/// from a bare `catch (_)`.
final class MutationFailed extends MutationResult {
  const MutationFailed(this.error, this.stackTrace);

  final Object error;
  final StackTrace stackTrace;
}

/// Runs [action] against one influencer, and only if it actually succeeded,
/// records it and refreshes whatever is showing that channel.
///
/// This is the core, and it takes no [BuildContext] on purpose: reporting the
/// outcome to a person is the caller's job, and coupling the write path to a
/// widget tree is what previously pushed callers without one into hand-rolling
/// their own. Widgets should call [guardInfluencerMutation] below instead,
/// which wraps this and shows the message.
///
/// [log] runs INSIDE the try, after the await — a write refused by the
/// server must not leave a log entry claiming it happened, and a log that
/// contains actions that never took place is worse than one with gaps.
///
/// **Every screen showing this channel is told, and none of them is named
/// here.** A successful write announces `channels` on the change bus (see
/// `core/events/data_change_bus.dart`) and every reader re-reads itself. This
/// replaced a hand-written list of `invalidate` calls that named the profile
/// page and nothing else — which is why editing a tag from a profile left the
/// list behind it, the dashboard tiles and the analytics charts on the old
/// value until the app was restarted.
///
/// [patchList] is now only about *latency*, not correctness. It updates the
/// caller's own row in the paged list with no round trip, so a chip or dropdown
/// settles the instant it is used instead of a quarter-second later when the
/// re-read lands. It takes the row as it stood before the mutation and returns
/// the row as it should now read, leaving scroll position, other rows and
/// pagination untouched. Worth passing from the list itself; unnecessary from
/// the profile page, whose own view re-reads either way.
///
/// It runs only on success, so a refused write can never leave the list showing
/// a value the database does not hold.
Future<MutationResult> runInfluencerMutation(
  WidgetRef ref,
  Influencer influencer, {
  required Future<EditOutcome> Function() action,
  void Function(ActivityLogger logger)? log,
  Influencer Function(Influencer current)? patchList,
}) async {
  final EditOutcome outcome;
  try {
    outcome = await action();
  } catch (error, stackTrace) {
    return MutationFailed(error, stackTrace);
  }

  if (outcome == EditOutcome.missing) return const MutationMissing();

  if (outcome == EditOutcome.conflict) {
    // The column was not written, so everything below would be a lie: no log
    // entry (it did not happen), and above all no patchList — leaving the
    // rejected value in the list would show a value the database does not hold,
    // which is the exact failure this whole layer exists to prevent.
    //
    // The by-id provider IS invalidated, so the page re-reads and the user sees
    // the value that actually won rather than their own rejected text sitting
    // there looking saved.
    // The channel DID change — somebody else's value is the one in it now — so
    // this is announced like any other change, and the profile re-reads to show
    // what actually won rather than leaving the rejected text sitting there
    // looking saved.
    ref.bumpData(const {DataDomain.channels, DataDomain.conflicts});
    return const MutationConflicted();
  }

  if (log != null) log(ref.read(activityLoggerProvider));

  // The caller's own row, updated with no round trip, so the chip or dropdown
  // they just used settles instantly instead of a quarter-second later. The
  // announcement below is what makes it *true* everywhere; this is only what
  // makes it feel immediate here.
  if (patchList != null) {
    ref
        .read(
            influencerPageProvider(ref.read(influencerFilterProvider)).notifier)
        .patchItem(influencer.id, patchList);
  }

  // Everything else in the app that reads channels — the list under this
  // profile, the dashboard tiles, the analytics charts, the country filter's
  // options — re-reads itself off this line. Nothing here needs to know they
  // exist, which is the point: this used to be a list of `invalidate` calls
  // that every new screen quietly made incomplete.
  ref.bumpData(const {DataDomain.channels, DataDomain.activity});
  return MutationApplied(outcome);
}

/// [runInfluencerMutation], plus telling the person what happened.
///
/// Every influencer write in the app goes through here. Before this existed as
/// the only path, four call sites had no error handling at all — the notes and
/// relevance-criteria editors among them, which left their text on screen after
/// a refused save and so reported success for a write that never landed.
///
/// [successMessage] is optional because most of these are already visible in
/// their result: a stage dropdown that moved, a tag chip that appeared. It is
/// worth passing only where the change leaves no trace of its own.
Future<MutationResult> guardInfluencerMutation(
  BuildContext context,
  WidgetRef ref,
  Influencer influencer, {
  required Future<EditOutcome> Function() action,
  void Function(ActivityLogger logger)? log,
  Influencer Function(Influencer current)? patchList,
  String? successMessage,
}) async {
  final result = await runInfluencerMutation(
    ref,
    influencer,
    action: action,
    log: log,
    patchList: patchList,
  );
  if (!context.mounted) return result;

  final l10n = AppLocalizations.of(context);
  final message = switch (result) {
    MutationApplied() => successMessage,
    // Deliberately not the generic save-failed message. Nothing went wrong and
    // nothing was lost — somebody else changed this field first, and what was
    // written is waiting on the Conflicts page. Telling a person "couldn't save
    // that change" here would send them off to retype work that still exists.
    MutationConflicted() => l10n.conflictDetectedSnack,
    MutationMissing() => l10n.conflictChannelGone,
    MutationFailed() => l10n.influencerProfileSaveFailed,
  };
  if (message != null) {
    final severity = switch (result) {
      MutationApplied() => ToastSeverity.success,
      MutationConflicted() => ToastSeverity.warning,
      MutationMissing() => ToastSeverity.error,
      MutationFailed() => ToastSeverity.error,
    };
    AppToast.show(context, message, severity: severity);
  }
  return result;
}
