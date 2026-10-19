import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/notifications/notification_service.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/scheduled_email.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/data/repositories/scheduled_email_store.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/application/outbound_recorder.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_label.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// How late a scheduled email may still go out on its own.
///
/// THE POLICY
/// ----------
/// While the app is open, an email goes out within [_tickInterval] of its
/// time. If the app was closed (or the machine asleep) at that time, the
/// email waits: once it is more than this late, it goes out only when a
/// person presses Send now. A "tomorrow at 9" email that fires at 3 in the
/// afternoon, because that is when somebody opened the laptop, may no longer
/// say the right thing -- a reply may have come, a deadline may have passed --
/// and only the person can tell.
const scheduledSendGrace = Duration(minutes: 15);

/// How often the list is checked while the app runs. Well inside
/// [scheduledSendGrace], so a missed tick or two never pushes an email past
/// it.
const _tickInterval = Duration(seconds: 30);

/// "Now", in UTC. A provider so tests can move time.
final scheduledSendClockProvider = Provider<DateTime Function()>(
  (ref) => () => DateTime.now().toUtc(),
);

/// The "Send later" list, and when it was last looked at.
class ScheduledSendState {
  const ScheduledSendState({
    this.emails = const [],
    this.loaded = false,
    this.checkedAt,
  });

  final List<ScheduledEmail> emails;

  /// The stored list has been read. Before that, nothing is sent and nothing
  /// is reported as needing attention.
  final bool loaded;

  /// The clock at the last tick -- what "late" is measured against, so the
  /// attention list changes when time passes, not only when the list does.
  final DateTime? checkedAt;

  List<ScheduledEmail> forThread(String threadId) => [
        for (final email in emails)
          if (email.threadId == threadId) email,
      ];

  /// Emails that wait for a person: failed ones, and ones past their time by
  /// more than [scheduledSendGrace]. Oldest first.
  List<ScheduledEmail> get needsAttention {
    final now = checkedAt;
    if (!loaded || now == null) return const [];
    return [
      for (final email in emails)
        if (isLate(email, now) || email.status == ScheduledEmailStatus.failed)
          email,
    ]..sort((a, b) => a.sendAt.compareTo(b.sendAt));
  }

  static bool isLate(ScheduledEmail email, DateTime now) =>
      email.status == ScheduledEmailStatus.scheduled &&
      now.difference(email.sendAt) > scheduledSendGrace;

  ScheduledSendState copyWith({
    List<ScheduledEmail>? emails,
    bool? loaded,
    DateTime? checkedAt,
  }) {
    return ScheduledSendState(
      emails: emails ?? this.emails,
      loaded: loaded ?? this.loaded,
      checkedAt: checkedAt ?? this.checkedAt,
    );
  }
}

/// What one send attempt came to.
enum ScheduledSendOutcome { sent, failed, busy, missing }

/// Holds the "Send later" list and sends each email when its time comes.
///
/// NOTHING GOES TWICE
/// ------------------
/// Every attempt at one email carries the same send key, and the mailbox
/// sends a key at most once (`mailbox.claim_send_key`). The email is marked
/// `sending` on disk before the mailbox is asked, and taken off the list the
/// moment the mailbox says it went -- before the CRM is written. So:
///
///  * the app dies while the mailbox is sending: at the next launch the email
///    is `scheduled` again, and the retry is answered with the original send
///    (`duplicate`), which is then recorded -- one email, one record;
///  * the app dies after the mailbox answered but before the CRM write: the
///    email is in Gmail and off the list, the CRM misses one outbound line.
///    That is the side `sendViaGmail` already chooses -- a message sent but
///    not recorded is visible in Gmail; one sent twice is in somebody's inbox.
///
/// Two ticks, or a tick and a Send now press, cannot send one email twice
/// either: [_inFlight] turns the second away before it reaches the mailbox.
class ScheduledSendController extends Notifier<ScheduledSendState> {
  Timer? _timer;
  final Set<String> _inFlight = {};
  Future<void> _writes = Future.value();
  Future<void>? _loading;

  @override
  ScheduledSendState build() {
    ref.onDispose(() => _timer?.cancel());
    return const ScheduledSendState();
  }

  DateTime _now() => ref.read(scheduledSendClockProvider)();

  /// Reads the stored list once. An email found `sending` is one the app died
  /// in the middle of; it goes back to `scheduled`, and the send key makes
  /// its retry safe.
  Future<void> ensureLoaded() => _loading ??= _load();

  Future<void> _load() async {
    final stored = await ref.read(scheduledEmailStoreProvider).load();
    final recovered = [
      for (final email in stored)
        email.status == ScheduledEmailStatus.sending
            ? email.copyWith(status: ScheduledEmailStatus.scheduled)
            : email,
    ];
    state = state.copyWith(
      emails: [...recovered, ...state.emails],
      loaded: true,
      checkedAt: _now(),
    );
  }

  /// Starts the loop. Idempotent -- the shell calls it on every build.
  void start() {
    if (_timer != null) return;
    _timer = Timer.periodic(_tickInterval, (_) => unawaited(tick()));
    unawaited(tick());
  }

  /// Sends whatever is due and not late; leaves late ones for a person.
  Future<int> tick() async {
    await ensureLoaded();
    final now = _now();
    state = state.copyWith(checkedAt: now);
    var sent = 0;
    for (final email in [...state.emails]) {
      if (email.status != ScheduledEmailStatus.scheduled) continue;
      if (email.sendAt.isAfter(now)) continue;
      if (ScheduledSendState.isLate(email, now)) continue;
      final outcome = await _send(email.id, automatic: true);
      if (outcome == ScheduledSendOutcome.sent) sent += 1;
    }
    return sent;
  }

  Future<void> add(ScheduledEmail email) async {
    await ensureLoaded();
    await _replace([...state.emails, email]);
  }

  ScheduledEmail? _find(String id) {
    for (final email in state.emails) {
      if (email.id == id) return email;
    }
    return null;
  }

  bool _editable(String id) =>
      !_inFlight.contains(id) &&
      _find(id)?.status != ScheduledEmailStatus.sending;

  /// Moves an email to [sendAtUtc], clearing a failure: a new time is a new
  /// try. False while it is being sent.
  Future<bool> reschedule(String id, DateTime sendAtUtc) async {
    final email = _find(id);
    if (email == null || !_editable(id)) return false;
    await _update(
      email.copyWith(
        sendAt: sendAtUtc.toUtc(),
        status: ScheduledEmailStatus.scheduled,
        lastError: null,
        lastFailure: null,
      ),
    );
    return true;
  }

  /// Drops an email unsent. False while it is being sent.
  Future<bool> cancel(String id) async {
    if (_find(id) == null || !_editable(id)) return false;
    await _replace([
      for (final email in state.emails)
        if (email.id != id) email,
    ]);
    return true;
  }

  /// Takes an email off the list so the composer can hold it again. Null
  /// while it is being sent.
  Future<ScheduledEmail?> takeBack(String id) async {
    final email = _find(id);
    if (email == null || !_editable(id)) return null;
    await cancel(id);
    return email;
  }

  /// Sends one email now, whatever its time.
  ///
  /// [evenIfMaybeSent] is for an email whose earlier attempt may have gone
  /// out ([ScheduledEmail.mayHaveBeenSent]): the person has checked Gmail and
  /// wants it sent regardless, so it gets a new send key -- otherwise the
  /// mailbox would, correctly, keep refusing it.
  Future<ScheduledSendOutcome> sendNow(
    String id, {
    bool evenIfMaybeSent = false,
  }) async {
    final email = _find(id);
    if (email == null) return ScheduledSendOutcome.missing;
    if (evenIfMaybeSent && email.mayHaveBeenSent) {
      await _update(email.copyWith(
          sendKey: '${email.id}:${_now().millisecondsSinceEpoch}'));
    }
    return _send(id, automatic: false);
  }

  Future<ScheduledSendOutcome> _send(String id,
      {required bool automatic}) async {
    if (_inFlight.contains(id)) return ScheduledSendOutcome.busy;
    var email = _find(id);
    if (email == null) return ScheduledSendOutcome.missing;
    _inFlight.add(id);
    try {
      email = email.copyWith(status: ScheduledEmailStatus.sending);
      await _update(email);

      final thread = await ref
          .read(outreachRepositoryProvider)
          .getThreadById(email.threadId);
      final influencer = await ref
          .read(influencerRepositoryProvider)
          .getById(email.influencerId);
      if (thread == null || influencer == null) {
        await _fail(
          email,
          const GmailError(
            failure: GmailFailure.badRequest,
            message: 'The channel or its conversation no longer exists.',
          ),
        );
        return ScheduledSendOutcome.failed;
      }

      final outcome = await ref.read(gmailGatewayProvider).send(
            GmailSendRequest(
              conversationKey: email.threadId,
              channelId: email.influencerId,
              to: email.to,
              subject: email.subject,
              body: email.body,
              // Worked out now, not when it was scheduled: the label says
              // where the channel is in the funnel as of this send.
              labels: outreachInfluencerLabels(
                pipelineStage: influencer.pipelineStage,
                threadStatus: thread.status,
              ),
              // Follow-ups saved with an older scheduled email are not sent:
              // a follow-up is drafted and approved when it is due (owner's
              // decision, 2026-10-18).
              sendKey: email.sendKey,
            ),
          );
      if (!outcome.succeeded) {
        await _fail(email, outcome.error!);
        return ScheduledSendOutcome.failed;
      }

      // Off the list first, then into the CRM -- see the class comment.
      await _replace([
        for (final other in state.emails)
          if (other.id != id) other,
      ]);
      try {
        await recordOutboundMessage(
          ref,
          thread: thread,
          influencer: influencer,
          subject: email.subject,
          body: email.body,
          method: ContactMethod.email,
          peerAddress: email.to,
          isAiDrafted: email.isAiDrafted,
          templateId: email.templateId,
        );
      } catch (error, stackTrace) {
        developer.log(
          'A scheduled email went out but could not be recorded.',
          name: 'gratovo.outreach.scheduled',
          level: 900,
          error: error,
          stackTrace: stackTrace,
        );
      }
      ref.invalidate(gmailStatusProvider);
      if (automatic) unawaited(_notifySent(email));
      return ScheduledSendOutcome.sent;
    } catch (error) {
      final current = _find(id);
      if (current != null) {
        await _fail(current, GmailError.unavailable('$error'));
      }
      return ScheduledSendOutcome.failed;
    } finally {
      _inFlight.remove(id);
    }
  }

  Future<void> _fail(ScheduledEmail email, GmailError error) => _update(
        email.copyWith(
          status: ScheduledEmailStatus.failed,
          attempts: email.attempts + 1,
          lastError: error.message,
          lastFailure: error.failure,
        ),
      );

  /// A desktop notice for an email that went out on its own -- the person
  /// scheduled it hours ago and may be anywhere else in the app, or not
  /// looking at it at all. Best-effort.
  Future<void> _notifySent(ScheduledEmail email) async {
    try {
      final l10n = lookupAppLocalizations(ref.read(localeProvider));
      await ref.read(notificationServiceProvider).show(
            id: email.id.hashCode & 0x7fffffff,
            title: l10n.outreachSendLaterSentTitle(email.handle),
            body: email.subject.isEmpty ? email.to : email.subject,
            payload: 'thread:${email.influencerId}',
          );
    } catch (_) {}
  }

  Future<void> _update(ScheduledEmail email) => _replace([
        for (final other in state.emails)
          if (other.id == email.id) email else other,
      ]);

  /// Sets the list and writes it, one write after another, so a slow write
  /// can never land after -- and undo -- a newer one.
  Future<void> _replace(List<ScheduledEmail> emails) {
    state = state.copyWith(emails: emails);
    final store = ref.read(scheduledEmailStoreProvider);
    final write = _writes.then((_) => store.save(emails));
    _writes = write.catchError((Object error, StackTrace stackTrace) {
      developer.log(
        'The scheduled emails could not be saved.',
        name: 'gratovo.outreach.scheduled',
        level: 1000,
        error: error,
        stackTrace: stackTrace,
      );
    });
    return _writes;
  }
}

final scheduledSendProvider =
    NotifierProvider<ScheduledSendController, ScheduledSendState>(
  ScheduledSendController.new,
);
