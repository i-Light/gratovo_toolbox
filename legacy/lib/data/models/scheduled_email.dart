import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';

/// Where one "Send later" email is in its life.
///
/// There is no `sent`: a message that went out leaves the list, before the
/// CRM hears about it (see `ScheduledSendController._send` for why that order).
enum ScheduledEmailStatus {
  /// Waiting for its time.
  scheduled,

  /// Handed to the mailbox and not answered yet. Found like this at launch,
  /// it means the app stopped mid-send; the retry carries the same
  /// [ScheduledEmail.sendKey], so the mailbox answers a message that did go
  /// out with the original send instead of sending it twice.
  sending,

  /// The mailbox refused it, or could not be reached. Waits for a person:
  /// Send now (retry), a new time, or Cancel.
  failed;

  static ScheduledEmailStatus parse(Object? raw) => switch (raw) {
        'sending' => ScheduledEmailStatus.sending,
        'failed' => ScheduledEmailStatus.failed,
        _ => ScheduledEmailStatus.scheduled,
      };
}

/// One email written now and sent by the app at [sendAt].
///
/// Gmail's API cannot schedule a send, so the app holds the message itself,
/// on this machine only: the mailbox that sends it is this machine's, and a
/// teammate's copy of the app has no business sending it. Everything the
/// composer would have sent at the moment of scheduling is here -- the
/// recipient, the words and the follow-ups -- so what goes out later is what
/// the person saw. The labels are the one thing worked out at send time, from
/// the channel's stage then, because that is what they are for.
class ScheduledEmail {
  const ScheduledEmail({
    required this.id,
    required this.threadId,
    required this.influencerId,
    required this.handle,
    required this.to,
    required this.subject,
    required this.body,
    required this.sendAt,
    required this.createdAt,
    String? sendKey,
    this.templateId,
    this.isAiDrafted = false,
    this.followUps = const [],
    this.status = ScheduledEmailStatus.scheduled,
    this.attempts = 0,
    this.lastError,
    this.lastFailure,
  }) : sendKey = sendKey ?? id;

  final String id;

  /// What the mailbox dedupes on: every attempt at this message carries it.
  /// The same as [id] until somebody chooses "Send anyway" on a message whose
  /// earlier attempt may have gone out -- that is a deliberate second send,
  /// and it gets a key of its own.
  final String sendKey;

  final String threadId;
  final String influencerId;

  /// The channel's handle when it was scheduled, for lists that must render
  /// without looking the channel up.
  final String handle;

  final String to;
  final String subject;
  final String body;
  final String? templateId;
  final bool isAiDrafted;

  /// The chases armed behind it, with blank bodies already filled with the
  /// default wording -- decided while the words were on screen.
  final List<GmailFollowUpDraft> followUps;

  /// When to send, UTC.
  final DateTime sendAt;
  final DateTime createdAt;

  final ScheduledEmailStatus status;
  final int attempts;
  final String? lastError;
  final GmailFailure? lastFailure;

  /// The last attempt may have gone out: an earlier try died before Gmail
  /// answered. A retry needs the person's say-so and a new [sendKey].
  bool get mayHaveBeenSent =>
      status == ScheduledEmailStatus.failed &&
      lastFailure == GmailFailure.sendUncertain;

  ScheduledEmail copyWith({
    String? sendKey,
    String? subject,
    String? body,
    DateTime? sendAt,
    ScheduledEmailStatus? status,
    int? attempts,
    Object? lastError = _unset,
    Object? lastFailure = _unset,
  }) {
    return ScheduledEmail(
      id: id,
      sendKey: sendKey ?? this.sendKey,
      threadId: threadId,
      influencerId: influencerId,
      handle: handle,
      to: to,
      subject: subject ?? this.subject,
      body: body ?? this.body,
      templateId: templateId,
      isAiDrafted: isAiDrafted,
      followUps: followUps,
      sendAt: sendAt ?? this.sendAt,
      createdAt: createdAt,
      status: status ?? this.status,
      attempts: attempts ?? this.attempts,
      lastError: lastError == _unset ? this.lastError : lastError as String?,
      lastFailure: lastFailure == _unset
          ? this.lastFailure
          : lastFailure as GmailFailure?,
    );
  }

  Map<String, Object?> toJson() => {
        'id': id,
        'sendKey': sendKey,
        'threadId': threadId,
        'influencerId': influencerId,
        'handle': handle,
        'to': to,
        'subject': subject,
        'body': body,
        if (templateId != null) 'templateId': templateId,
        'isAiDrafted': isAiDrafted,
        'followUps': [
          for (final step in followUps)
            {
              'delayDays': step.delayDays,
              if (step.dueAt != null)
                'dueAt': step.dueAt!.toUtc().toIso8601String(),
              'body': step.body,
              if (step.subject != null) 'subject': step.subject,
            },
        ],
        'sendAt': sendAt.toUtc().toIso8601String(),
        'createdAt': createdAt.toUtc().toIso8601String(),
        'status': status.name,
        'attempts': attempts,
        if (lastError != null) 'lastError': lastError,
        if (lastFailure != null) 'lastFailure': lastFailure!.name,
      };

  /// Null for an entry too broken to send -- no id, no recipient, no time.
  /// Dropping one of those is safer than guessing what it meant to say.
  static ScheduledEmail? fromJson(Object? raw) {
    if (raw is! Map) return null;
    String? text(String key) {
      final value = raw[key];
      return value is String ? value : null;
    }

    DateTime? instant(String key) {
      final value = text(key);
      return value == null ? null : DateTime.tryParse(value)?.toUtc();
    }

    final id = text('id');
    final to = text('to');
    final sendAt = instant('sendAt');
    final threadId = text('threadId');
    if (id == null || to == null || sendAt == null || threadId == null) {
      return null;
    }
    final failureName = text('lastFailure');
    return ScheduledEmail(
      id: id,
      sendKey: text('sendKey'),
      threadId: threadId,
      influencerId: text('influencerId') ?? '',
      handle: text('handle') ?? '',
      to: to,
      subject: text('subject') ?? '',
      body: text('body') ?? '',
      templateId: text('templateId'),
      isAiDrafted: raw['isAiDrafted'] == true,
      followUps: [
        for (final step
            in raw['followUps'] is List ? raw['followUps'] as List : const [])
          if (step is Map && step['body'] is String)
            GmailFollowUpDraft(
              delayDays: (step['delayDays'] as num?)?.toInt() ?? 3,
              dueAt: step['dueAt'] is String
                  ? DateTime.tryParse(step['dueAt'] as String)?.toUtc()
                  : null,
              body: step['body'] as String,
              subject: step['subject'] as String?,
            ),
      ],
      sendAt: sendAt,
      createdAt: instant('createdAt') ?? sendAt,
      status: ScheduledEmailStatus.parse(raw['status']),
      attempts: (raw['attempts'] as num?)?.toInt() ?? 0,
      lastError: text('lastError'),
      lastFailure: failureName == null
          ? null
          : GmailFailure.values.asNameMap()[failureName],
    );
  }
}

const _unset = Object();
