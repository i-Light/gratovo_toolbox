/// The JSON contract between `pipeline/tools/email_send.py` and this app.
///
/// Pure Dart, no `dart:io` — so it compiles and unit-tests on every platform
/// including web, exactly like `scraper_process_types.dart` beside it. The
/// process launching lives in `scraper_process_io.dart`; everything about what
/// the tool *said* lives here, which is what makes the parsing testable
/// without a Python interpreter.
///
/// Every command prints exactly one JSON object. Two shapes, and which one
/// arrived is the first thing every parse here decides:
///
/// ```json
/// {"ok": true,  "command": "run-due", ...}
/// {"ok": false, "error": {"code": "not_configured", "message": "..."}}
/// ```
///
/// `code` is a stable slug the UI switches on to decide what to *offer* —
/// "reconnect the mailbox" reads very differently from "install the Python
/// dependencies", and both read better than the raw sentence underneath.
library;

import 'dart:convert';

/// Why a mailbox operation could not be done, in terms the UI can act on.
enum GmailFailure {
  /// No credentials on this machine. Not an error — an unconnected mailbox.
  notConfigured,

  /// The `google-api-python-client` stack is not installed on this interpreter.
  dependencyMissing,

  /// Credentials exist and Google refused them — almost always the seven-day
  /// test-user token having lapsed. Reconnecting is the fix.
  authFailed,

  /// Gmail answered with an error: rate limit, outage, over the sending quota.
  apiError,

  /// The request was malformed, or the tool was called wrongly. A bug here,
  /// not out there.
  badRequest,

  /// This machine has more than one mailbox connected and the caller didn't
  /// say which one — a send, test-send or sign-out that needs exactly one.
  ambiguousAccount,

  /// An earlier attempt at this exact message (same send key) stopped before
  /// Gmail answered, so it may already be in the recipient's inbox. Only a
  /// person looking at the Sent folder can settle it; nothing is retried.
  sendUncertain,

  /// This mailbox has already sent its daily cap of cold email (house choice
  /// HC-02, set per mailbox in Settings). Nothing went out; it can go
  /// tomorrow, or after the cap is raised.
  dailyCapReached,

  /// The interpreter never produced parseable JSON — missing Python, a missing
  /// `pipeline/` folder, an import that blew up before `main()`.
  unavailable,

  /// Anything the tool reported that this app does not have a case for.
  unknown;

  static GmailFailure fromCode(String? code) => switch (code) {
        'not_configured' => GmailFailure.notConfigured,
        'dependency_missing' => GmailFailure.dependencyMissing,
        'auth_failed' => GmailFailure.authFailed,
        'api_error' => GmailFailure.apiError,
        'ambiguous_account' => GmailFailure.ambiguousAccount,
        'send_uncertain' => GmailFailure.sendUncertain,
        'daily_cap_reached' => GmailFailure.dailyCapReached,
        'bad_payload' || 'bad_usage' || 'tool_error' => GmailFailure.badRequest,
        _ => GmailFailure.unknown,
      };

  /// Whether reconnecting the mailbox is the thing that would fix this. Drives
  /// whether the UI offers that button rather than just stating the problem.
  bool get isFixedByReconnecting =>
      this == GmailFailure.notConfigured || this == GmailFailure.authFailed;
}

class GmailError {
  const GmailError({required this.failure, required this.message, this.detail});

  final GmailFailure failure;
  final String message;
  final String? detail;

  /// The catch-all for a process that did not speak the protocol at all. Its
  /// [message] is whatever the interpreter managed to say, which is usually a
  /// traceback's last line and is the only clue there is.
  factory GmailError.unavailable(String message) => GmailError(
        failure: GmailFailure.unavailable,
        message: message.trim().isEmpty
            ? 'The mailbox tool did not run.'
            : message.trim(),
      );

  static GmailError? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final message = raw['message'];
    return GmailError(
      failure: GmailFailure.fromCode(raw['code'] as String?),
      message: message is String && message.trim().isNotEmpty
          ? message.trim()
          : 'The mailbox reported an error.',
      detail: raw['detail'] as String?,
    );
  }
}

/// One mailbox connected on this machine, as `--status` reports it inside
/// its `accounts` list — a machine can have more than one now, each
/// authorized separately and each sending under its own address.
class GmailAccountStatus {
  const GmailAccountStatus({
    required this.account,
    required this.connected,
    this.error,
    this.counters = const GmailCounters(),
    this.lastSweepAt,
    this.limits,
  });

  /// The address this mailbox sends as. Null only for the legacy
  /// single-token fallback before anything has resolved it — see
  /// `Config.google_accounts` on the Python side.
  final String? account;

  /// Google actually accepted this mailbox's token just now. [error] says
  /// why not, when false.
  final bool connected;

  final GmailError? error;
  final GmailCounters counters;
  final DateTime? lastSweepAt;

  /// The daily cap and warm-up, or null from a tool that predates them.
  final GmailLimits? limits;

  /// Whether the composer may send as this specific mailbox.
  bool get canSend => connected && (account?.isNotEmpty ?? false);

  static GmailAccountStatus fromJson(Map<String, Object?> json) =>
      GmailAccountStatus(
        account: _string(json['account']),
        connected: json['connected'] == true,
        error: GmailError.fromJson(json['error']),
        counters: GmailCounters.fromJson(json['counters']),
        lastSweepAt: _timestamp(json['lastSweepAt']),
        limits: GmailLimits.fromJson(json['limits']),
      );
}

/// One mailbox's daily cap of cold email (house choice HC-02) and warm-up
/// (HC-03), as `--status` reports them from this machine's
/// `settings.local.json`. The warm-up itself runs in Instantly; the app only
/// counts days from the date a person types in.
class GmailLimits {
  const GmailLimits({
    required this.dailyCap,
    required this.sentToday,
    required this.leftToday,
    this.warmupStartedOn,
  });

  /// The house rule's floor and ceiling, and its default.
  static const int minCap = 10;
  static const int maxCap = 50;
  static const int defaultCap = 35;

  /// Fewer days than this and the mailbox is still warming (HC-03).
  static const int minWarmupDays = 14;

  final int dailyCap;
  final int sentToday;
  final int leftToday;

  /// A calendar date, local: the day the warm-up started.
  final DateTime? warmupStartedOn;

  /// Whole days since the warm-up started, or null when no date is set.
  int? warmupDays(DateTime now) {
    final start = warmupStartedOn;
    if (start == null) return null;
    final today = DateTime(now.year, now.month, now.day);
    return today.difference(start).inDays;
  }

  /// At least the 14-day minimum. False when no date is set: unknown is not
  /// warmed.
  bool warmedEnough(DateTime now) => (warmupDays(now) ?? -1) >= minWarmupDays;

  static GmailLimits? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final started = _string(raw['warmupStartedOn']);
    final parsed = started == null ? null : DateTime.tryParse(started);
    return GmailLimits(
      dailyCap: _int(raw['dailyCap']) ?? defaultCap,
      sentToday: _int(raw['sentToday']) ?? 0,
      leftToday: _int(raw['leftToday']) ?? 0,
      warmupStartedOn: parsed == null
          ? null
          : DateTime(parsed.year, parsed.month, parsed.day),
    );
  }
}

/// [local] (this machine's `settings.local.json`) with one mailbox's limits
/// set, everything else untouched. The tool reads `mailboxes` -> address ->
/// `daily_cap` / `warmup_started_on`; addresses are stored lower-case, as
/// the tool matches them.
Map<String, Object?> mergeMailboxLimits(
  Map<String, Object?> local,
  String account, {
  required int dailyCap,
  required DateTime? warmupStartedOn,
}) {
  final mailboxes = <String, Object?>{
    ...?(local['mailboxes'] as Map?)?.cast<String, Object?>(),
  };
  final key = account.trim().toLowerCase();
  final start = warmupStartedOn;
  mailboxes[key] = <String, Object?>{
    'daily_cap': dailyCap.clamp(GmailLimits.minCap, GmailLimits.maxCap),
    if (start != null)
      'warmup_started_on': '${start.year.toString().padLeft(4, '0')}-'
          '${start.month.toString().padLeft(2, '0')}-'
          '${start.day.toString().padLeft(2, '0')}',
  };
  return {...local, 'mailboxes': mailboxes};
}

/// What `--status` found: every mailbox connected on this machine, and what
/// each currently owes.
///
/// [accounts] is the real answer, and the Settings row that lists every
/// signed-in mailbox reads it directly. Everything else on this class is a
/// convenience for callers that predate multiple accounts and just want to
/// know "is there SOMETHING here that can send" — the composer and the
/// Outreach page header — resolved to [primaryAccount]: the first connected
/// one, or (so a lapsed token still has something to explain itself through)
/// the first account at all.
class GmailStatus {
  const GmailStatus({
    required this.configured,
    this.label,
    this.senderName,
    GmailError? error,
    this.accounts = const [],
  }) : _error = error;

  /// A machine that has never been set up. The default the app shows before
  /// the first `--status` lands, and what the web build always reports.
  static const unconfigured = GmailStatus(configured: false);

  /// An OAuth client and at least one mailbox are present in the .env files.
  final bool configured;

  final String? label;
  final String? senderName;

  /// A failure covering the whole machine (no OAuth client, nothing
  /// connected at all) rather than one mailbox.
  final GmailError? _error;

  final List<GmailAccountStatus> accounts;

  /// The first connected account, or — if none are connected — the first
  /// account at all. Null only when nothing is connected here whatsoever.
  GmailAccountStatus? get primaryAccount {
    if (accounts.isEmpty) return null;
    for (final entry in accounts) {
      if (entry.connected) return entry;
    }
    return accounts.first;
  }

  /// Whether the composer may offer "Send with Gmail" at all — true as soon
  /// as ANY connected mailbox can send, regardless of which.
  bool get canSend => accounts.any((entry) => entry.canSend);

  /// [primaryAccount]'s address, for callers that show "connected as x" and
  /// don't (yet) let someone pick which of several mailboxes that means.
  String? get account => primaryAccount?.account;

  /// The machine-wide failure if there is one, else [primaryAccount]'s own.
  GmailError? get error => _error ?? primaryAccount?.error;

  /// Every connected mailbox's numbers, added together — what the Outreach
  /// page header means by "12 sent, 3 awaiting a reply" on a machine with
  /// more than one mailbox doing the sending.
  GmailCounters get counters => accounts.fold(
      const GmailCounters(), (sum, entry) => sum + entry.counters);

  static GmailStatus fromJson(Map<String, Object?> json) => GmailStatus(
        configured: json['configured'] == true,
        label: _string(json['label']),
        senderName: _string(json['senderName']),
        error: GmailError.fromJson(json['error']),
        accounts: [
          for (final raw in _list(json['accounts']))
            if (raw is Map)
              GmailAccountStatus.fromJson(raw.cast<String, Object?>()),
        ],
      );
}

/// The mailbox's own numbers, for the Settings card and the Outreach header.
class GmailCounters {
  const GmailCounters({
    this.sent = 0,
    this.awaitingReply = 0,
    this.replied = 0,
    this.pendingSteps = 0,
    this.dueSteps = 0,
    this.failedSteps = 0,
    this.unreportedReplies = 0,
  });

  final int sent;
  final int awaitingReply;
  final int replied;

  /// Follow-ups queued and not yet sent.
  final int pendingSteps;

  /// Of those, how many are due now — non-zero here means the next sweep has
  /// work, which is what makes "Check now" worth offering.
  final int dueSteps;

  /// Follow-ups that gave up after repeated failures. Worth surfacing: these
  /// are silent otherwise.
  final int failedSteps;

  final int unreportedReplies;

  /// Field-wise sum — how several mailboxes' counters combine into one
  /// machine-wide total (see [GmailStatus.counters]).
  GmailCounters operator +(GmailCounters other) => GmailCounters(
        sent: sent + other.sent,
        awaitingReply: awaitingReply + other.awaitingReply,
        replied: replied + other.replied,
        pendingSteps: pendingSteps + other.pendingSteps,
        dueSteps: dueSteps + other.dueSteps,
        failedSteps: failedSteps + other.failedSteps,
        unreportedReplies: unreportedReplies + other.unreportedReplies,
      );

  static GmailCounters fromJson(Object? raw) {
    if (raw is! Map) return const GmailCounters();
    int read(String key) {
      final value = raw[key];
      if (value is int) return value;
      if (value is num) return value.toInt();
      return 0;
    }

    return GmailCounters(
      sent: read('sent'),
      awaitingReply: read('awaitingReply'),
      replied: read('replied'),
      pendingSteps: read('pendingSteps'),
      dueSteps: read('dueSteps'),
      failedSteps: read('failedSteps'),
      unreportedReplies: read('unreportedReplies'),
    );
  }
}

/// One message the mailbox sent, as reported back by `--send`.
class GmailSendReceipt {
  const GmailSendReceipt({
    required this.account,
    required this.conversationKey,
    required this.messageId,
    required this.sentAt,
    this.threadId,
    this.threaded = false,
    this.labelled = false,
    this.queuedFollowUps = const [],
    this.duplicate = false,
  });

  final String account;

  /// The app's outreach thread id — the tool keys its own state by it, so a
  /// reply comes back naming the thread the reply belongs to.
  final String conversationKey;

  final String messageId;
  final String? threadId;

  /// Whether this landed inside an existing Gmail conversation rather than
  /// starting one.
  final bool threaded;

  final bool labelled;
  final DateTime sentAt;
  final List<GmailQueuedStep> queuedFollowUps;

  /// This send key had already gone out: nothing was sent this time, and the
  /// fields above describe the original send. What a retry after a crash
  /// gets back instead of a second copy in somebody's inbox.
  final bool duplicate;

  static GmailSendReceipt fromJson(Map<String, Object?> json) =>
      GmailSendReceipt(
        duplicate: json['duplicate'] == true,
        account: _string(json['account']) ?? '',
        conversationKey: _string(json['conversationKey']) ?? '',
        messageId: _string(json['messageId']) ?? '',
        threadId: _string(json['threadId']),
        threaded: json['threaded'] == true,
        labelled: json['labelled'] == true,
        sentAt: _timestamp(json['sentAt']) ?? DateTime.now().toUtc(),
        queuedFollowUps: [
          for (final raw in _list(json['followUps']))
            if (raw is Map)
              GmailQueuedStep.fromJson(raw.cast<String, Object?>()),
        ],
      );
}

/// A follow-up sitting in the queue with a time on it.
class GmailQueuedStep {
  const GmailQueuedStep({
    required this.stepNo,
    required this.dueAt,
    this.id,
    this.conversationKey,
    this.subject,
    this.body,
  });

  final int stepNo;
  final DateTime dueAt;
  final String? id;
  final String? conversationKey;
  final String? subject;
  final String? body;

  static GmailQueuedStep fromJson(Map<String, Object?> json) => GmailQueuedStep(
        stepNo: _int(json['stepNo']) ?? 0,
        dueAt: _timestamp(json['dueAt']) ?? DateTime.now().toUtc(),
        id: _string(json['id']),
        conversationKey: _string(json['conversationKey']),
        subject: _string(json['subject']),
        body: _string(json['body']),
      );
}

/// A reply the mailbox saw and has not yet been told was handled.
///
/// Everything the app needs to act on one is here, because acting on it is a
/// sequence of writes the tool must not be asked about again: record it in the
/// CRM, stop the chase, and — for the first one — move the channel to
/// interested.
class GmailReply {
  const GmailReply({
    required this.conversationKey,
    required this.messageId,
    required this.receivedAt,
    this.channelId,
    this.fromAddress,
    this.fromName,
    this.subject = '',
    this.body = '',
    this.isFirstReply = false,
    this.cancelledFollowUps = 0,
  });

  /// The app's outreach thread id this reply belongs to.
  final String conversationKey;

  /// The YouTube channel, when the send recorded one — which is what lets the
  /// app move the influencer to `interested` without a lookup.
  final String? channelId;

  final String messageId;
  final String? fromAddress;
  final String? fromName;
  final String subject;
  final String body;
  final DateTime receivedAt;

  /// True only for the first reply ever seen on this conversation. The signal
  /// that flips the channel to `interested`; a later reply must not re-run it,
  /// and only the mailbox can tell the two apart.
  final bool isFirstReply;

  /// How many queued follow-ups this reply stopped, so the UI can say so.
  final int cancelledFollowUps;

  String get displayName {
    final name = fromName?.trim();
    if (name != null && name.isNotEmpty) return name;
    return fromAddress?.trim() ?? '';
  }

  static GmailReply fromJson(Map<String, Object?> json) => GmailReply(
        conversationKey: _string(json['conversationKey']) ?? '',
        channelId: _string(json['channelId']),
        messageId: _string(json['messageId']) ?? '',
        fromAddress: _string(json['from']),
        fromName: _string(json['fromName']),
        subject: _string(json['subject']) ?? '',
        body: _string(json['body']) ?? '',
        receivedAt: _timestamp(json['receivedAt']) ?? DateTime.now().toUtc(),
        isFirstReply: json['isFirstReply'] == true,
        cancelledFollowUps: _int(json['cancelledFollowUps']) ?? 0,
      );
}

/// A follow-up the mailbox sent on its own, without anyone pressing anything.
class GmailAutoSend {
  const GmailAutoSend({
    required this.conversationKey,
    required this.messageId,
    required this.stepNo,
    required this.sentAt,
    this.channelId,
    this.to,
    this.subject = '',
    this.body = '',
  });

  final String conversationKey;
  final String? channelId;
  final String messageId;
  final int stepNo;
  final String? to;
  final String subject;
  final String body;
  final DateTime sentAt;

  static GmailAutoSend fromJson(Map<String, Object?> json) => GmailAutoSend(
        conversationKey: _string(json['conversationKey']) ?? '',
        channelId: _string(json['channelId']),
        messageId: _string(json['messageId']) ?? '',
        stepNo: _int(json['stepNo']) ?? 0,
        to: _string(json['to']),
        subject: _string(json['subject']) ?? '',
        body: _string(json['body']) ?? '',
        sentAt: _timestamp(json['sentAt']) ?? DateTime.now().toUtc(),
      );
}

/// A follow-up that could not be sent.
class GmailSendFailure {
  const GmailSendFailure({
    required this.conversationKey,
    required this.stepNo,
    required this.message,
    this.channelId,
    this.givenUp = false,
  });

  final String conversationKey;
  final String? channelId;
  final int stepNo;
  final String message;

  /// True once the step has exhausted its attempts and will not be retried.
  /// The only case worth telling anyone about — a transient failure fixes
  /// itself on the next sweep.
  final bool givenUp;

  static GmailSendFailure fromJson(Map<String, Object?> json) =>
      GmailSendFailure(
        conversationKey: _string(json['conversationKey']) ?? '',
        channelId: _string(json['channelId']),
        stepNo: _int(json['stepNo']) ?? 0,
        message: _string(json['error']) ?? 'The follow-up could not be sent.',
        givenUp: json['givenUp'] == true,
      );
}

/// Everything one `--run-due` sweep found and did.
class GmailSweep {
  const GmailSweep({
    required this.account,
    this.checked = 0,
    this.replies = const [],
    this.autoSent = const [],
    this.failures = const [],
    this.counters = const GmailCounters(),
  });

  static const empty = GmailSweep(account: '');

  final String account;

  /// How many conversations were asked about.
  final int checked;

  final List<GmailReply> replies;
  final List<GmailAutoSend> autoSent;
  final List<GmailSendFailure> failures;
  final GmailCounters counters;

  bool get isEmpty => replies.isEmpty && autoSent.isEmpty && failures.isEmpty;

  /// Failures worth interrupting somebody about — see [GmailSendFailure.givenUp].
  List<GmailSendFailure> get permanentFailures => [
        for (final failure in failures)
          if (failure.givenUp) failure
      ];

  static GmailSweep fromJson(Map<String, Object?> json) => GmailSweep(
        account: _string(json['account']) ?? '',
        checked: _int(json['checked']) ?? 0,
        replies: [
          for (final raw in _list(json['replies']))
            if (raw is Map) GmailReply.fromJson(raw.cast<String, Object?>()),
        ],
        autoSent: [
          for (final raw in _list(json['sent']))
            if (raw is Map) GmailAutoSend.fromJson(raw.cast<String, Object?>()),
        ],
        failures: [
          for (final raw in _list(json['failed']))
            if (raw is Map)
              GmailSendFailure.fromJson(raw.cast<String, Object?>()),
        ],
        counters: GmailCounters.fromJson(json['counters']),
      );
}

/// A parsed tool invocation: either [value] or [error], never both.
///
/// Modelled as a result rather than thrown exceptions because a failed mailbox
/// call is an ordinary thing the UI renders — an unconnected machine, a lapsed
/// token — and making every caller wrap a `try` around the normal case is how
/// those get swallowed into a generic "something went wrong".
class GmailOutcome<T> {
  const GmailOutcome.success(this.value)
      : error = null,
        rawOutput = null;
  const GmailOutcome.failure(this.error, {this.rawOutput}) : value = null;

  final T? value;
  final GmailError? error;

  /// What the process actually printed, kept only on a failure — it is the
  /// difference between a debuggable report and "it didn't work".
  final String? rawOutput;

  bool get succeeded => error == null && value != null;
}

/// Finds and decodes the tool's one JSON object in [output].
///
/// Scans for the last line that parses as a JSON object rather than decoding
/// the whole of stdout, because the interpreter is entitled to print things
/// this app did not ask for: a `DeprecationWarning` from a library, a
/// `sitecustomize` banner, a proxy notice. The tool's own output is one line
/// and it is the last one, so this survives all of that instead of failing on
/// a warning that changed nothing.
Map<String, Object?>? decodeToolOutput(String output) {
  final lines = const LineSplitter().convert(output);
  for (final line in lines.reversed) {
    final trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      final decoded = jsonDecode(trimmed);
      if (decoded is Map<String, Object?>) return decoded;
    } on FormatException {
      continue;
    }
  }
  return null;
}

/// Turns raw process output into an outcome, applying [parse] to a success.
///
/// One funnel for every command, so "the process printed a traceback", "the
/// tool reported `ok: false`" and "it worked" are told apart in exactly one
/// place.
GmailOutcome<T> parseToolOutcome<T>(
  String output,
  T Function(Map<String, Object?> json) parse,
) {
  final json = decodeToolOutput(output);
  if (json == null) {
    return GmailOutcome<T>.failure(
      GmailError.unavailable(_lastMeaningfulLine(output)),
      rawOutput: output,
    );
  }
  if (json['ok'] != true) {
    return GmailOutcome<T>.failure(
      GmailError.fromJson(json['error']) ??
          GmailError.unavailable(_lastMeaningfulLine(output)),
      rawOutput: output,
    );
  }
  return GmailOutcome<T>.success(parse(json));
}

/// The last non-blank line, which for a Python crash is the exception itself.
String _lastMeaningfulLine(String output) {
  for (final line in const LineSplitter().convert(output).reversed) {
    if (line.trim().isNotEmpty) return line.trim();
  }
  return '';
}

String? _string(Object? value) {
  if (value is! String) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

int? _int(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return null;
}

List<Object?> _list(Object? value) => value is List ? value : const [];

/// The tool stamps times as `2026-09-04T11:22:33Z`. Parsed as UTC, always:
/// dropping the zone would put a reply that arrived an hour ago in the future
/// on a machine west of Greenwich.
DateTime? _timestamp(Object? value) {
  if (value is! String || value.trim().isEmpty) return null;
  return DateTime.tryParse(value.trim())?.toUtc();
}

/// One follow-up as an older build's composer described it, before it
/// existed. Kept only so a scheduled send saved by such a build still loads;
/// nothing sends these any more (owner decision, plan step 1).
///
/// [delayDays] rather than an absolute time: "chase in 3 days" is measured
/// from the moment the first message actually goes out, which is the only
/// reading that matches what the person choosing it meant — and that moment is
/// not knowable until the send succeeds.
class GmailFollowUpDraft {
  const GmailFollowUpDraft({
    required this.delayDays,
    required this.body,
    this.subject,
    this.dueAt,
  });

  final int delayDays;
  final String body;

  /// Null means "Re: whatever the first message's subject was", resolved by
  /// the tool at send time so a retitled thread stays consistent.
  final String? subject;

  /// An exact moment to send at, instead of [delayDays] after the first
  /// message goes out.
  ///
  /// The two are alternatives, not a pair: a delay is what somebody means by
  /// "chase in three days" and is measured from the send, while this is what
  /// they mean by "chase on Tuesday morning" — a launch date, a conference, a
  /// time zone they know the recipient reads mail in.
  final DateTime? dueAt;

  Map<String, Object?> toJson() => {
        if (dueAt == null) 'delayDays': delayDays,
        if (dueAt != null) 'dueAt': dueAt!.toUtc().toIso8601String(),
        'body': body,
        if (subject != null && subject!.trim().isNotEmpty) 'subject': subject,
      };
}

/// A request to send one outreach email. Nothing is armed behind it: a
/// follow-up is another message a person sends (owner decision, plan step 1).
class GmailSendRequest {
  const GmailSendRequest({
    required this.conversationKey,
    required this.to,
    required this.body,
    this.subject = '',
    this.channelId,
    this.labels = const [],
    this.newThread = false,
    this.account,
    this.sendKey,
  });

  /// The app's outreach thread id. What makes a reply findable in the CRM.
  final String conversationKey;

  /// One id for every attempt at this one message. The mailbox sends a key
  /// at most once and answers a repeat with [GmailSendReceipt.duplicate];
  /// a scheduled send passes its own id, so the retry after a crash cannot
  /// put a second copy in the recipient's inbox. Null for a plain send.
  final String? sendKey;

  /// Which connected mailbox to send as. Null means "the only one" — the
  /// tool resolves that itself and errors with [GmailFailure.ambiguousAccount]
  /// if this machine has more than one and none was named.
  final String? account;

  /// The YouTube channel id, carried so a reply can move the influencer to
  /// `interested` without the app having to look up which thread it was.
  final String? channelId;

  final String to;
  final String subject;
  final String body;

  /// Gmail sub-label paths for this message, relative to the mailbox's parent
  /// outreach label — e.g. `['Influencers', 'Stage/Contacted']`. The tool
  /// prepends the configured parent (`cfg.outreach_label`) to each and applies
  /// the parent itself as well, so a search on any level finds the message.
  /// Empty means "parent label only", the historical behaviour.
  final List<String> labels;

  /// Start a fresh Gmail thread even if this conversation already has one.
  final bool newThread;

  Map<String, Object?> toJson() => {
        'conversationKey': conversationKey,
        if (channelId != null) 'channelId': channelId,
        'to': to,
        'subject': subject,
        'body': body,
        if (labels.isNotEmpty) 'labels': labels,
        if (newThread) 'newThread': true,
        if (account != null && account!.isNotEmpty) 'account': account,
        if (sendKey != null && sendKey!.isNotEmpty) 'sendKey': sendKey,
      };
}
