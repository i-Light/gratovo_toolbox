import 'package:gratovo_toolbox/core/native/comms_protocol.dart';

/// What a person did with a proposal in the Comms queue.
enum CommsQueueStatus {
  /// Waiting for a person.
  proposed,
  approved,
  sent,
  skipped,

  /// The send was tried and did not go out; still waiting for a person.
  failed,

  /// Refused or failing the checks: shown with why, not sendable.
  blocked;

  bool get isOpen =>
      this == CommsQueueStatus.proposed ||
      this == CommsQueueStatus.failed ||
      this == CommsQueueStatus.blocked;

  static CommsQueueStatus fromWire(Object? value) =>
      CommsQueueStatus.values.firstWhere((s) => s.name == value,
          orElse: () => CommsQueueStatus.proposed);
}

/// One item of the Comms queue (`comms_proposals`, synced to the team): a
/// message the engine proposed — or refused to — and what a person did with
/// it. Nothing here is ever sent by itself.
class CommsProposal {
  const CommsProposal({
    required this.id,
    required this.kind,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    this.threadId,
    this.channelId,
    this.brandId,
    this.engineStatus,
    this.situation = const {},
    this.steer = const {},
    this.action,
    this.why,
    this.rules = const [],
    this.needsHuman = const [],
    this.subject = '',
    this.body = '',
    this.followUpDays,
    this.variant,
    this.model,
    this.error,
    this.decidedBy,
    this.decidedAt,
  });

  final String id;
  final CommsKind kind;
  final CommsQueueStatus status;
  final String? threadId;
  final String? channelId;
  final String? brandId;
  final CommsEngineStatus? engineStatus;

  /// The engine's read of the case; prefills the Steer panel.
  final Map<String, Object?> situation;

  /// The person's corrections that produced this draft.
  final Map<String, Object?> steer;
  final String? action;
  final String? why;
  final List<String> rules;

  /// What a person confirms before it goes: the engine's questions and the
  /// checks' gates (price, terms, claim, ethics).
  final List<CommsGate> needsHuman;
  final String subject;
  final String body;
  final int? followUpDays;
  final String? variant;
  final String? model;

  /// Why it is blocked or failed, in words.
  final String? error;
  final String? decidedBy;
  final DateTime? decidedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get hasMessage => body.trim().isNotEmpty;

  /// A new queue item from what `comms_propose` returned for [request].
  factory CommsProposal.fromResult(
    CommsRequest request,
    CommsProposalResult result, {
    DateTime? now,
  }) {
    final at = (now ?? DateTime.now()).toUtc();
    final blocking = [
      for (final f in result.findings)
        if (f.blocking) f,
    ];
    return CommsProposal(
      id: '',
      kind: request.kind,
      status: result.status == CommsEngineStatus.blocked
          ? CommsQueueStatus.blocked
          : CommsQueueStatus.proposed,
      threadId: request.threadId,
      channelId: request.channelId,
      brandId: request.brandId,
      engineStatus: result.status,
      situation: result.situation,
      steer: {
        ...request.steer,
        if ((request.note ?? '').trim().isNotEmpty)
          'note': request.note!.trim(),
        if (request.cashOffer) 'cashOffer': true,
      },
      action: result.action,
      why: result.why,
      rules: result.rules,
      needsHuman: [...result.needsHuman, ...result.gates],
      subject: result.subject,
      body: result.body,
      followUpDays: result.followUpDays,
      variant: 'auto',
      model: result.model,
      error: blocking.isEmpty
          ? null
          : blocking.map((f) => '${f.rule}: ${f.detail}').join('\n'),
      createdAt: at,
      updatedAt: at,
    );
  }

  CommsProposal copyWith({String? id, CommsQueueStatus? status}) =>
      CommsProposal(
        id: id ?? this.id,
        kind: kind,
        status: status ?? this.status,
        threadId: threadId,
        channelId: channelId,
        brandId: brandId,
        engineStatus: engineStatus,
        situation: situation,
        steer: steer,
        action: action,
        why: why,
        rules: rules,
        needsHuman: needsHuman,
        subject: subject,
        body: body,
        followUpDays: followUpDays,
        variant: variant,
        model: model,
        error: error,
        decidedBy: decidedBy,
        decidedAt: decidedAt,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}
