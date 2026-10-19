import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_scheduler_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// How often the app sweeps the mailbox while it is open.
///
/// Five minutes is a compromise between two real costs and one real benefit. A
/// sweep is one Gmail call per conversation still awaiting a reply, so a tight
/// loop is both slow and rude to a shared API quota. Against that: noticing a
/// reply automatically clears the thread's follow-up reminders, and somebody
/// sees the reply while it is still the same conversation in their head. The
/// sweep only looks; nothing is ever sent by it.
const _sweepInterval = Duration(minutes: 5);

/// How long after launch the first sweep runs.
///
/// Not zero: the first seconds after launch are already spent signing in,
/// restoring the shell and warming the pipeline, and a Gmail round trip in the
/// middle of that competes with the frame budget for no benefit — a reply that
/// arrived overnight can wait another twenty seconds.
const _firstSweepDelay = Duration(seconds: 20);

/// The mailbox loop's visible state.
class OutreachInboxState {
  const OutreachInboxState({
    this.isSweeping = false,
    this.lastSweepAt,
    this.repliesApplied = 0,
    this.followUpsSent = 0,
    this.error,
  });

  final bool isSweeping;
  final DateTime? lastSweepAt;

  /// Replies recorded in the CRM by the most recent sweep.
  final int repliesApplied;

  /// Follow-ups the mailbox sent by itself in the most recent sweep.
  final int followUpsSent;

  /// Why the last sweep did not happen. Null once one succeeds.
  ///
  /// Held rather than thrown: a machine with no mailbox connected is the
  /// normal state for most of the team, and it must not present as an error on
  /// a page they are using for something else.
  final GmailError? error;

  OutreachInboxState copyWith({
    bool? isSweeping,
    DateTime? lastSweepAt,
    int? repliesApplied,
    int? followUpsSent,
    Object? error = _unset,
  }) {
    return OutreachInboxState(
      isSweeping: isSweeping ?? this.isSweeping,
      lastSweepAt: lastSweepAt ?? this.lastSweepAt,
      repliesApplied: repliesApplied ?? this.repliesApplied,
      followUpsSent: followUpsSent ?? this.followUpsSent,
      error: error == _unset ? this.error : error as GmailError?,
    );
  }
}

const _unset = Object();

/// What one sweep did, for whoever asked for it.
class InboxSweepReport {
  const InboxSweepReport({
    this.replies = 0,
    this.followUpsSent = 0,
    this.followUpsCancelled = 0,
    this.newlyInterested = 0,
    this.permanentFailures = 0,
    this.error,
  });

  final int replies;
  final int followUpsSent;

  /// Queued follow-ups that the arriving replies stopped — the interrupt,
  /// counted so a person can be told what did not go out on their behalf.
  final int followUpsCancelled;

  /// Channels moved to `interested` because they answered for the first time.
  final int newlyInterested;

  final int permanentFailures;
  final GmailError? error;

  bool get foundNothing =>
      replies == 0 && followUpsSent == 0 && permanentFailures == 0;
}

/// Watches the outreach mailbox and applies what it finds to the CRM.
///
/// THE DIVISION OF LABOUR
/// ----------------------
/// `tools/email_send.py` decides everything about *email*: which conversation
/// has a reply, which follow-up is due, and — critically — that a follow-up is
/// never sent to somebody who has already answered. That guarantee lives in
/// SQL, in one join, because a guarantee that depends on the app being open is
/// not a guarantee.
///
/// This class decides everything about what a reply *means* to the business,
/// and it is a fixed sequence per reply:
///
///   1. record it as an inbound message on the thread, so the conversation
///      reads correctly whoever opens it;
///   2. move the thread to `replied`;
///   3. clear the human follow-up reminders for that channel — the same
///      interrupt the email sequence just performed, applied to the nudges a
///      person would otherwise get about chasing someone who has answered;
///   4. **on the first reply only**, move the channel to `interested`;
///   5. post a desktop notification;
///   6. log it, then acknowledge it to the mailbox.
///
/// Acknowledgement is last on purpose. The tool keeps offering a reply until
/// it is told the CRM has it, so an app that dies at step 3 sees the reply
/// again on the next sweep rather than dropping it on the floor.
///
/// WHY THE FIRST REPLY IS SPECIAL
/// ------------------------------
/// Answering at all is the signal. A creator who writes back once has
/// self-selected out of the cold pile, and that is what `interested` means on
/// [PipelineStage] — it is the stage between `contacted` and `roster`. A
/// second or third reply says nothing new about the stage, and re-applying it
/// would drag a channel that has since reached `negotiating` back down the
/// funnel. Only the mailbox can tell a first reply from a later one, which is
/// why [GmailReply.isFirstReply] comes from there rather than being inferred
/// here from a message count a teammate may have written.
class OutreachInboxController extends Notifier<OutreachInboxState> {
  Timer? _timer;

  /// Guards against overlapping sweeps: the periodic timer, a manual press and
  /// a post-send check can all arrive at once, and each would then apply the
  /// same replies. The tool is idempotent, but doing the CRM writes twice is
  /// not — the second pass would insert a duplicate inbound message before the
  /// first pass's acknowledgement landed.
  bool _inFlight = false;

  @override
  OutreachInboxState build() {
    // No timer under test unless somebody asks for one: an autostarting
    // periodic Gmail call in every widget test is exactly the kind of thing
    // that makes a suite flaky and slow.
    ref.onDispose(() => _timer?.cancel());
    return const OutreachInboxState();
  }

  /// Starts the background loop. Idempotent — `AppShell` reads this on every
  /// build and only the first call arms anything.
  void start() {
    if (_timer != null) return;
    _timer = Timer.periodic(_sweepInterval, (_) => unawaited(sweep()));
    Timer(_firstSweepDelay, () => unawaited(sweep()));
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// One sweep for replies, applying whatever it finds.
  ///
  /// It never sends. Follow-ups used to be queued in the mailbox and fired from
  /// here when due; the owner's rule is that every outgoing message waits for a
  /// person (decision of 2026-10-18), so a follow-up is now a reminder whose
  /// text is written and approved when it is due. [checkOnly] is kept so a
  /// caller saying so explicitly still reads right; both values only check.
  Future<InboxSweepReport> sweep({bool checkOnly = true}) async {
    if (_inFlight) return const InboxSweepReport();
    _inFlight = true;
    state = state.copyWith(isSweeping: true);
    try {
      final outcome =
          await ref.read(gmailGatewayProvider).runDue(checkOnly: true);
      if (!outcome.succeeded) {
        state = state.copyWith(
          isSweeping: false,
          lastSweepAt: DateTime.now().toUtc(),
          error: outcome.error,
        );
        return InboxSweepReport(error: outcome.error);
      }

      final report = await _apply(outcome.value!);
      state = state.copyWith(
        isSweeping: false,
        lastSweepAt: DateTime.now().toUtc(),
        repliesApplied: report.replies,
        followUpsSent: report.followUpsSent,
        error: null,
      );
      return report;
    } finally {
      _inFlight = false;
      if (state.isSweeping) state = state.copyWith(isSweeping: false);
    }
  }

  /// Sweeps one conversation, for the thread somebody currently has open.
  ///
  /// Never sends: opening a thread is not a request to fire its queued
  /// follow-up early.
  Future<InboxSweepReport> sweepConversation(String threadId) async {
    final outcome = await ref
        .read(gmailGatewayProvider)
        .runDue(checkOnly: true, conversationKey: threadId);
    if (!outcome.succeeded) return InboxSweepReport(error: outcome.error);
    return _apply(outcome.value!);
  }

  Future<InboxSweepReport> _apply(GmailSweep sweep) async {
    var cancelled = 0;
    var interested = 0;
    final acknowledged = <String>[];

    for (final reply in sweep.replies) {
      try {
        final becameInterested = await _applyReply(reply);
        if (becameInterested) interested += 1;
        cancelled += reply.cancelledFollowUps;
        acknowledged.add(reply.messageId);
      } catch (error, stackTrace) {
        // Deliberately not rethrown and deliberately not acknowledged: the
        // reply stays unreported, so the next sweep offers it again. Losing a
        // reply is far worse than applying it a few minutes late.
        developer.log(
          'A reply could not be recorded; it will be offered again on the '
          'next sweep.',
          name: 'gratovo.outreach.inbox',
          level: 900,
          error: error,
          stackTrace: stackTrace,
        );
      }
    }

    for (final message in sweep.autoSent) {
      try {
        await _recordAutoSend(message);
      } catch (error, stackTrace) {
        // The email is already gone; failing here would only hide it from the
        // conversation view. Logged rather than retried, because a retry would
        // mean sending it again.
        developer.log(
          'A follow-up was sent but could not be recorded on its thread.',
          name: 'gratovo.outreach.inbox',
          level: 900,
          error: error,
          stackTrace: stackTrace,
        );
      }
    }

    for (final failure in sweep.permanentFailures) {
      await _notifyFailure(failure);
    }

    if (acknowledged.isNotEmpty) {
      await ref.read(gmailGatewayProvider).acknowledge(acknowledged);
    }

    if (sweep.replies.isNotEmpty || sweep.autoSent.isNotEmpty) {
      ref.bumpData(const {
        DataDomain.outreach,
        DataDomain.channels,
        DataDomain.reminders,
        DataDomain.activity,
      });
    }

    return InboxSweepReport(
      replies: acknowledged.length,
      followUpsSent: sweep.autoSent.length,
      followUpsCancelled: cancelled,
      newlyInterested: interested,
      permanentFailures: sweep.permanentFailures.length,
    );
  }

  /// The six steps, in order. Returns whether this moved a channel to
  /// `interested`.
  Future<bool> _applyReply(GmailReply reply) async {
    final outreach = ref.read(outreachRepositoryProvider);

    await outreach.recordMessage(
      threadId: reply.conversationKey,
      direction: MessageDirection.inbound,
      subject: reply.subject,
      body: reply.body,
      method: ContactMethod.email,
      peerAddress: reply.fromAddress,
      at: reply.receivedAt,
    );
    await outreach.updateThreadStatus(
      reply.conversationKey,
      ThreadStatus.replied,
    );

    final channelId = reply.channelId;
    Influencer? influencer;
    if (channelId != null && channelId.isNotEmpty) {
      // The same interrupt the email sequence just performed, applied to the
      // human nudges: a reminder to chase somebody who has replied is worse
      // than no reminder at all.
      await ref
          .read(followUpSchedulerProvider)
          .clearAllForInfluencer(channelId);
      influencer = await _readInfluencer(channelId);
    }

    var becameInterested = false;
    if (reply.isFirstReply && influencer != null) {
      becameInterested = await _markInterested(influencer);
    }

    await _notifyReply(reply, influencer);

    ref.read(activityLoggerProvider).replyReceived(
          threadId: reply.conversationKey,
          label: influencer?.handle ?? reply.displayName,
          subject: reply.subject,
        );
    return becameInterested;
  }

  /// Moves a channel to `interested`, and only ever forwards.
  ///
  /// The guard is the important half. A channel that has reached `negotiating`
  /// or `roster` is further along than "they answered an email", and applying
  /// `interested` to it because a stray message landed on an old thread would
  /// walk it backwards through the funnel — silently, on a schedule, with no
  /// person involved to notice. So only the two stages that genuinely precede
  /// it are advanced; `lost` is left alone too, because reviving a channel is
  /// a decision, not a side effect of a mail sweep.
  Future<bool> _markInterested(Influencer influencer) async {
    const advanceableFrom = {PipelineStage.isNew, PipelineStage.contacted};
    if (!advanceableFrom.contains(influencer.pipelineStage)) return false;

    try {
      await ref.read(influencerRepositoryProvider).updatePipelineStage(
            influencer.id,
            PipelineStage.interested,
            base: influencer.pipelineStage,
          );
      ref.read(activityLoggerProvider).channelStageChanged(
            influencer,
            before: influencer.pipelineStage,
            after: PipelineStage.interested,
          );
      return true;
    } catch (error, stackTrace) {
      // A refused stage write (a conflict, or a reader without authority) must
      // not cost the reply that was already recorded. The thread status is the
      // load-bearing signal; the stage is a convenience on top of it.
      developer.log(
        'Could not move ${influencer.handle} to interested after a reply.',
        name: 'gratovo.outreach.inbox',
        level: 800,
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  Future<void> _recordAutoSend(GmailAutoSend message) async {
    await ref.read(outreachRepositoryProvider).recordMessage(
          threadId: message.conversationKey,
          direction: MessageDirection.outbound,
          subject: message.subject,
          body: message.body,
          method: ContactMethod.email,
          peerAddress: message.to,
          at: message.sentAt,
        );
  }

  Future<void> _notifyReply(GmailReply reply, Influencer? influencer) async {
    final who = influencer?.handle ?? reply.displayName;
    final subject = reply.subject.trim();
    final l10n = _l10n;
    await _notify(
      id: reply.messageId,
      title: who.isEmpty
          ? l10n.outreachNotifyReplyAnonymousTitle
          : l10n.outreachNotifyReplyTitle(who),
      body: subject.isEmpty ? reply.body.trim() : subject,
      payload: influencer == null ? null : 'thread:${influencer.id}',
    );
  }

  Future<void> _notifyFailure(GmailSendFailure failure) async {
    await _notify(
      id: '${failure.conversationKey}:${failure.stepNo}',
      title: _l10n.outreachNotifyFollowUpFailedTitle,
      body: failure.message,
    );
  }

  /// The strings for the UI language, resolved without a widget tree: these
  /// notifications fire from a background timer, not from a screen.
  AppLocalizations get _l10n =>
      lookupAppLocalizations(ref.read(localeProvider));

  /// Posts a toast, best-effort.
  ///
  /// Never asks for permission and never blocks on it: this fires from a
  /// background timer with no one waiting, and a permission prompt appearing
  /// out of nowhere five minutes after launch is worse than a missing toast.
  /// The reply is already in the CRM by the time this runs, which is the
  /// channel that actually has to work.
  Future<void> _notify({
    required String id,
    required String title,
    required String body,
    String? payload,
  }) async {
    try {
      await ref.read(notificationServiceProvider).show(
            id: id.hashCode & 0x7fffffff,
            title: title,
            body: body.length > 200 ? '${body.substring(0, 197)}...' : body,
            payload: payload,
          );
    } catch (error, stackTrace) {
      developer.log(
        'Reply notification could not be posted.',
        name: 'gratovo.outreach.inbox',
        level: 800,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<Influencer?> _readInfluencer(String id) async {
    try {
      return await ref.read(influencerRepositoryProvider).getById(id);
    } catch (_) {
      // A basic-authority reader cannot see the channel row. The reply is
      // still recorded and the thread still moves; only the stage nudge and
      // the handle in the toast are lost.
      return null;
    }
  }
}

final outreachInboxProvider =
    NotifierProvider<OutreachInboxController, OutreachInboxState>(
  OutreachInboxController.new,
);
