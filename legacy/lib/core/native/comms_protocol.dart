/// The Comms queue's two daemon actions (`pipeline/gemini_bridge/actions.py`,
/// docs/plans/decisions_build_plan.md step 6):
///
///  * `comms_propose` builds the live case from the local database (thread,
///    creator facts and their latest video's moments, deal, brand, the
///    agency's facts) and asks the engine for one proposal. Several minutes.
///  * `comms_check` checks text a person edited again before it goes — the
///    engine's deterministic checks and the gates a person confirms. No Gemini.
///
/// Nothing is ever sent by either: every message waits for a person.
library;

import 'package:gratovo_toolbox/core/native/gemini_bridge_types.dart';

/// What the queue asks the engine to write.
enum CommsKind {
  first,
  reply,
  followUp,
  decision;

  static CommsKind fromWire(Object? value) => CommsKind.values
      .firstWhere((k) => k.name == value, orElse: () => CommsKind.reply);
}

/// The engine's verdict on its own proposal.
enum CommsEngineStatus {
  /// Checks pass: approve and send.
  ready,

  /// A decision or a fact is needed from a person first.
  needsHuman,

  /// Refused (policy) or still failing the checks after repair: not sendable.
  blocked,

  /// Nothing to send now: wait, close, schedule.
  noMessage;

  String get wire => switch (this) {
        CommsEngineStatus.ready => 'ready',
        CommsEngineStatus.needsHuman => 'needs_human',
        CommsEngineStatus.blocked => 'blocked',
        CommsEngineStatus.noMessage => 'no_message',
      };

  static CommsEngineStatus fromWire(Object? value) => switch (value) {
        'ready' => CommsEngineStatus.ready,
        'needs_human' => CommsEngineStatus.needsHuman,
        'no_message' => CommsEngineStatus.noMessage,
        _ => CommsEngineStatus.blocked,
      };
}

/// One request: the kind, who it is for, and the person's corrections.
class CommsRequest {
  const CommsRequest({
    required this.kind,
    this.threadId,
    this.channelId,
    this.brandId,
    this.contactEmail,
    this.pitchChannelIds = const [],
    this.followUpNumber,
    this.steer = const {},
    this.note,
    this.cashOffer = false,
  });

  final CommsKind kind;
  final String? threadId;
  final String? channelId;
  final String? brandId;
  final String? contactEmail;

  /// For a brand pitch: the creators pitched (BRD-PRES-15 checks each).
  final List<String> pitchChannelIds;

  /// For a follow-up: which one of the three.
  final int? followUpNumber;

  /// The Steer panel: knob id -> option id (the old knobs, now optional).
  final Map<String, String> steer;

  /// The Steer panel's free correction.
  final String? note;

  /// House choice HC-10, switched on for this case only.
  final bool cashOffer;

  CommsRequest copyWith({
    Map<String, String>? steer,
    String? note,
    bool? cashOffer,
  }) =>
      CommsRequest(
        kind: kind,
        threadId: threadId,
        channelId: channelId,
        brandId: brandId,
        contactEmail: contactEmail,
        pitchChannelIds: pitchChannelIds,
        followUpNumber: followUpNumber,
        steer: steer ?? this.steer,
        note: note ?? this.note,
        cashOffer: cashOffer ?? this.cashOffer,
      );

  Map<String, Object?> toJson() {
    final note = this.note?.trim() ?? '';
    return {
      'kind': kind.name,
      if (threadId != null) 'threadId': threadId,
      if (channelId != null) 'channelId': channelId,
      if (brandId != null) 'brandId': brandId,
      if (contactEmail != null) 'contactEmail': contactEmail,
      if (pitchChannelIds.isNotEmpty) 'pitchChannelIds': pitchChannelIds,
      if (followUpNumber != null) 'followUpNumber': followUpNumber,
      if (steer.isNotEmpty || note.isNotEmpty)
        'steer': {...steer, if (note.isNotEmpty) 'note': note},
      if (cashOffer) 'cashOffer': true,
    };
  }
}

/// A finding from the engine's checks.
class CommsFinding {
  const CommsFinding({
    required this.code,
    required this.severity,
    required this.rule,
    required this.detail,
  });

  final String code;
  final String severity;
  final String rule;
  final String detail;

  bool get blocking => severity == 'block';

  static CommsFinding fromJson(Object? raw) {
    final json = asMap(raw);
    return CommsFinding(
      code: asString(json['code']) ?? '',
      severity: asString(json['severity']) ?? 'warn',
      rule: asString(json['rule']) ?? '',
      detail: asString(json['detail']) ?? '',
    );
  }
}

/// Something a person confirms before the message goes: price, terms, a
/// claim about the agency, ethics — or what the engine asked them.
class CommsGate {
  const CommsGate({required this.what, this.detail = ''});

  final String what;
  final String detail;

  static CommsGate fromJson(Object? raw) {
    final json = asMap(raw);
    return CommsGate(
      what: asString(json['what']) ?? '',
      detail: asString(json['detail']) ??
          asString(json['question']) ??
          asString(json['why']) ??
          '',
    );
  }
}

/// What `comms_propose` returned.
class CommsProposalResult {
  const CommsProposalResult({
    required this.status,
    this.subject = '',
    this.body = '',
    this.action,
    this.why,
    this.rules = const [],
    this.situation = const {},
    this.needsHuman = const [],
    this.gates = const [],
    this.findings = const [],
    this.followUpDays,
    this.side,
    this.stage,
    this.moments = const [],
    this.model,
  });

  final CommsEngineStatus status;
  final String subject;
  final String body;
  final String? action;

  /// The why-line: why this is the next step.
  final String? why;

  /// The playbook rules the decision cites.
  final List<String> rules;

  /// The engine's read of the case — what prefills the Steer panel.
  final Map<String, Object?> situation;
  final List<CommsGate> needsHuman;
  final List<CommsGate> gates;
  final List<CommsFinding> findings;

  /// When to follow up if they do not reply, in working days.
  final int? followUpDays;
  final String? side;
  final String? stage;

  /// The usable moments read from the creator's latest video (first emails).
  final List<Map<String, Object?>> moments;
  final String? model;

  bool get hasMessage => body.trim().isNotEmpty;

  static CommsProposalResult fromJson(Map<String, Object?> json) {
    final proposal = asMap(json['proposal']);
    final decision = asMap(proposal['decision']);
    final message = asMap(proposal['message']);
    final followUp = asMap(proposal['follow_up']);
    final kase = asMap(json['case']);
    return CommsProposalResult(
      status: CommsEngineStatus.fromWire(json['status']),
      subject: asString(message['subject']) ?? '',
      body: message['body'] is String ? message['body']! as String : '',
      action: asString(decision['action']),
      why: asString(decision['why']),
      rules: asStringList(decision['rules']),
      situation: asMap(proposal['situation']),
      needsHuman: [
        for (final item in asList(proposal['needs_human']))
          CommsGate.fromJson(item),
      ],
      gates: [
        for (final item in asList(json['gates'])) CommsGate.fromJson(item)
      ],
      findings: [
        for (final item in asList(json['findings']))
          CommsFinding.fromJson(item),
      ],
      followUpDays: asInt(followUp['in_working_days']),
      side: asString(kase['side']),
      stage: asString(kase['stage']),
      moments: [
        for (final item in asList(json['moments']))
          if (item is Map) item.cast<String, Object?>(),
      ],
      model: asString(json['model']),
    );
  }
}

/// What `comms_check` returned for edited text.
class CommsCheckResult {
  const CommsCheckResult({
    required this.blocking,
    this.findings = const [],
    this.gates = const [],
  });

  final bool blocking;
  final List<CommsFinding> findings;
  final List<CommsGate> gates;

  static CommsCheckResult fromJson(Map<String, Object?> json) =>
      CommsCheckResult(
        blocking: json['blocking'] == true,
        findings: [
          for (final item in asList(json['findings']))
            CommsFinding.fromJson(item),
        ],
        gates: [
          for (final item in asList(json['gates'])) CommsGate.fromJson(item)
        ],
      );
}

/// The engine runs about four to five minutes a case (2026-10-17 median), and
/// a first email adds reading the video: ten minutes before the app gives up.
const int kCommsProposeTimeoutS = 600;

extension CommsBridge on GeminiBridge {
  Future<CommsProposalResult> commsPropose(
    CommsRequest request, {
    int timeoutS = kCommsProposeTimeoutS,
  }) async {
    await prepareForAction();
    return CommsProposalResult.fromJson(await call(
      'action.comms_propose',
      {'request': request.toJson(), 'timeoutS': timeoutS},
      Duration(seconds: timeoutS + 120),
    ));
  }

  /// Off the Gemini page: no browser is prepared for it.
  Future<CommsCheckResult> commsCheck(
    CommsRequest request, {
    required String subject,
    required String body,
  }) async =>
      CommsCheckResult.fromJson(await call(
        'action.comms_check',
        {'request': request.toJson(), 'subject': subject, 'body': body},
        const Duration(seconds: 60),
      ));
}
