import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// The one seam between the app and the outreach mailbox.
///
/// Everything above this line — the composer, the reply watcher, the Settings
/// card — deals in [GmailOutcome]s and knows nothing about Python, temporary
/// files or exit codes. Everything below it is `tools/email_send.py`.
///
/// It exists as an interface rather than as calls to [ScraperProcess] directly
/// for one reason worth the indirection: the code that *reacts* to a reply is
/// the interesting part — it writes to the CRM, cancels reminders, moves a
/// channel to `interested` and posts a notification — and none of that should
/// need a Gmail account, a Python interpreter or a network to test. A fake
/// gateway makes those tests ordinary.
abstract class GmailGateway {
  /// Every mailbox this machine sends as, and what each currently owes.
  Future<GmailOutcome<GmailStatus>> status();

  /// Connects one more mailbox on this machine: opens a browser, captures the
  /// grant, adds it to `data/gmail_accounts.local.json` (or refreshes it in
  /// place if that address was already connected). Resolves with the
  /// connected address (empty string if the tool could not confirm one).
  ///
  /// Can take a minute or more — it is waiting on a person in a browser tab —
  /// so callers must show that something is in progress.
  Future<GmailOutcome<String>> connect();

  /// Forgets one of this machine's mailboxes by clearing its saved token.
  /// Does not revoke the grant at Google. [account] picks which; it may be
  /// left out only when at most one mailbox is connected. Safe to call when
  /// nothing is connected.
  Future<GmailOutcome<bool>> disconnect({String? account});

  /// Sends one message; nothing is queued behind it.
  /// [GmailSendRequest.account] picks which connected mailbox sends it.
  Future<GmailOutcome<GmailSendReceipt>> send(GmailSendRequest request);

  /// One sweep: find replies, then send whatever is due and still owed, for
  /// one connected mailbox ([account], or the only one if this machine has
  /// just one).
  ///
  /// [checkOnly] sweeps without sending — for the manual "check for replies"
  /// action, where quietly firing a batch of queued follow-ups because someone
  /// pressed refresh would be a genuinely bad surprise.
  Future<GmailOutcome<GmailSweep>> runDue({
    bool checkOnly = false,
    String? conversationKey,
    int? limit,
    String? account,
  });

  /// Confirms [messageIds] are recorded in the CRM, so they stop being offered.
  Future<GmailOutcome<int>> acknowledge(List<String> messageIds);

  /// Drops every queued follow-up on one conversation.
  Future<GmailOutcome<int>> cancelFollowUps(String conversationKey);

  /// Sends a test message from one connected mailbox ([account], or the only
  /// one if this machine has just one), recording nothing.
  Future<GmailOutcome<String>> sendTest({String? to, String? account});
}

/// The real gateway: runs `pipeline/tools/email_send.py` and parses its JSON.
class PipelineGmailGateway implements GmailGateway {
  PipelineGmailGateway(this._ref);

  final Ref _ref;

  /// Resolved per call rather than held, because Settings → Search Tuning can
  /// change both the interpreter and the project root while the app is open,
  /// and a gateway holding the old pair would keep talking to the old folder.
  ({String python, ScraperProcessPaths paths})? _environment() {
    final env = _ref.read(pythonEnvironmentProvider);
    final override = env.projectRootOverride.trim();
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride: override.isEmpty ? null : override,
    );
    // Null on web — the same "is there a project folder here at all" question
    // `LocalSearchRepository` asks, with the same answer.
    if (paths == null) return null;
    return (python: env.pythonExecutable, paths: paths);
  }

  static const _noPipeline = GmailError(
    failure: GmailFailure.unavailable,
    message: 'There is no local pipeline on this machine to send through.',
  );

  /// Runs [invoke] and parses the result, turning any thrown exception into a
  /// [GmailOutcome] failure.
  ///
  /// The catch is not laziness about error handling — it is the point. A
  /// missing interpreter, a `pipeline/` folder that was moved, a permission
  /// error on the temp file: all of them surface out of [ScraperProcess] as
  /// exceptions, and every one of them means "the mailbox is not reachable",
  /// which is a state the UI already renders. Letting them propagate would
  /// turn each into an unhandled error in a Riverpod provider instead.
  Future<GmailOutcome<T>> _run<T>(
    Future<ProcessResultLite> Function(String python, ScraperProcessPaths paths)
        invoke,
    T Function(Map<String, Object?> json) parse,
  ) async {
    final environment = _environment();
    if (environment == null) return const GmailOutcome.failure(_noPipeline);
    try {
      final result = await invoke(environment.python, environment.paths);
      return parseToolOutcome(result.output, parse);
    } catch (error) {
      return GmailOutcome<T>.failure(GmailError.unavailable('$error'));
    }
  }

  @override
  Future<GmailOutcome<GmailStatus>> status() => _run(
        (python, paths) => GmailBridge.gmailStatus(
          pythonExecutable: python,
          paths: paths,
        ),
        GmailStatus.fromJson,
      );

  @override
  Future<GmailOutcome<String>> connect() => _run(
        (python, paths) => GmailBridge.gmailAuthorize(
          pythonExecutable: python,
          paths: paths,
        ),
        (json) => (json['account'] as String?)?.trim() ?? '',
      );

  @override
  Future<GmailOutcome<bool>> disconnect({String? account}) => _run(
        (python, paths) => GmailBridge.gmailSignOut(
          pythonExecutable: python,
          paths: paths,
          account: account,
        ),
        (_) => true,
      );

  @override
  Future<GmailOutcome<GmailSendReceipt>> send(GmailSendRequest request) => _run(
        (python, paths) => GmailBridge.gmailSend(
          pythonExecutable: python,
          paths: paths,
          request: request,
        ),
        GmailSendReceipt.fromJson,
      );

  @override
  Future<GmailOutcome<GmailSweep>> runDue({
    bool checkOnly = false,
    String? conversationKey,
    int? limit,
    String? account,
  }) =>
      _run(
        (python, paths) => GmailBridge.gmailRunDue(
          pythonExecutable: python,
          paths: paths,
          checkOnly: checkOnly,
          conversationKey: conversationKey,
          limit: limit,
          account: account,
        ),
        GmailSweep.fromJson,
      );

  @override
  Future<GmailOutcome<int>> acknowledge(List<String> messageIds) {
    if (messageIds.isEmpty) return Future.value(const GmailOutcome.success(0));
    return _run(
      (python, paths) => GmailBridge.gmailAcknowledgeReplies(
        pythonExecutable: python,
        paths: paths,
        messageIds: messageIds,
      ),
      (json) => (json['acknowledged'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  Future<GmailOutcome<int>> cancelFollowUps(String conversationKey) => _run(
        (python, paths) => GmailBridge.gmailCancelFollowUps(
          pythonExecutable: python,
          paths: paths,
          conversationKey: conversationKey,
        ),
        (json) => (json['cancelled'] as num?)?.toInt() ?? 0,
      );

  @override
  Future<GmailOutcome<String>> sendTest({String? to, String? account}) => _run(
        (python, paths) => GmailBridge.gmailTestSend(
          pythonExecutable: python,
          paths: paths,
          to: to,
          account: account,
        ),
        (json) => (json['to'] as String?) ?? '',
      );
}

final gmailGatewayProvider = Provider<GmailGateway>(PipelineGmailGateway.new);

/// Which mailbox is connected, refreshed on demand.
///
/// A [FutureProvider] rather than state the app pushes around: the answer
/// lives on this machine's disk and in Google's opinion of a token, neither of
/// which the app controls, so asking is the only honest way to know. Invalidate
/// it after connecting a mailbox or after a send, and every watcher updates.
final gmailStatusProvider = FutureProvider<GmailStatus>((ref) async {
  final outcome = await ref.watch(gmailGatewayProvider).status();
  if (outcome.succeeded) return outcome.value!;
  // A failed `--status` is still an answer about the mailbox: report it as an
  // unconnected one carrying the reason, rather than as a provider error the
  // whole Outreach page has to have an error state for.
  return GmailStatus(
    configured: false,
    error: outcome.error,
  );
});
