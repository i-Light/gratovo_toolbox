import 'dart:convert';

import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';

/// The skill factory's last bench run (`data/gemini skills/outreach/bench/
/// latest.json`, written by the factory's `export_app.py`) as library
/// records: one "test draft" per bench draft, unrated.
///
/// The draft is the email; the judge's roast, the lint flags and the repeat
/// hits are its critique; its knobs ride along so a bad verdict can be drafted
/// again. [EmailRecord.sourceRef] is the draft's id in the file, which is what
/// makes importing the same run twice add nothing.
///
/// Lenient like every reader of the factory's files: a draft with no id or no
/// body is skipped, an unknown field is ignored, and text that is not JSON at
/// all reads as no drafts. Throws nothing.
List<EmailRecord> benchDraftRecords(String text, {DateTime? now}) {
  final Object? decoded;
  try {
    decoded = jsonDecode(text);
  } on FormatException {
    return const [];
  }
  if (decoded is! Map) return const [];
  final runAt = _string(decoded['runAt']);
  final drafts = decoded['drafts'];
  if (drafts is! List) return const [];
  final at = (now ?? DateTime.now()).toUtc();
  return [
    for (final draft in drafts)
      if (draft is Map)
        if (_record(draft.cast<String, Object?>(), runAt, at) case final r?) r,
  ];
}

EmailRecord? _record(Map<String, Object?> draft, String? runAt, DateTime at) {
  final id = _string(draft['id']);
  final body = _string(draft['body']);
  if (id == null || body == null) return null;
  final knobs = <String, String>{
    if (draft['knobs'] case final Map raw)
      for (final entry in raw.entries)
        if (entry.key is String && entry.value is String)
          entry.key as String: entry.value as String,
  };
  final stage = emailStageTagForKnob(knobs['stage']);
  return EmailRecord(
    id: localUuid(),
    audience: knobs['reader'] == 'brand'
        ? EmailAudience.brand
        : EmailAudience.influencer,
    stageTagIds: [if (stage != null) stage],
    context: [
      'Bench run ${runAt ?? '?'}',
      if (_string(draft['caseTitle']) case final title?) title,
      if (_string(draft['variant']) case final variant?) 'variant $variant',
    ].join(' · '),
    subject: _string(draft['subject']) ?? '',
    body: body,
    critique: benchCritique(draft),
    createdAt: at,
    updatedAt: at,
    source: EmailRecordSource.testDraft,
    sourceRef: id,
    knobs: knobs,
  );
}

/// The judge's score and roast, what it failed, the lint's flags and the
/// repeat hits, as one plain-text critique. Parts the bench left empty are
/// left out rather than shown as "none".
String benchCritique(Map<String, Object?> draft) {
  final lines = <String>[];
  if (draft['judge'] case final Map judge) {
    final score = judge['score'];
    final roast = _string(judge['roast']);
    if (score is num || roast != null) {
      lines.add([
        if (score is num)
          'Judge ${score is int ? score : score.toStringAsFixed(1)}/10',
        if (roast != null) roast,
      ].join(': '));
    }
    if (judge['fails'] case final List fails) {
      for (final fail in fails) {
        if (fail is! Map) continue;
        final rule = _string(fail['rule']);
        final why = _string(fail['why']);
        if (rule == null && why == null) continue;
        lines.add('- Fails "${rule ?? '?'}"${why == null ? '' : ': $why'}');
      }
    }
  }
  if (draft['lint'] case final Map lint) {
    final flags = [
      if (lint['flags'] case final List raw)
        for (final flag in raw)
          if (flag is Map)
            if (_string(flag['rule']) case final rule?) rule else 'flag'
          else if (flag is String && flag.trim().isNotEmpty)
            flag.trim(),
    ];
    final words = lint['words'];
    if (flags.isNotEmpty || words is num) {
      lines.add([
        if (words is num) 'Lint: $words words',
        if (flags.isEmpty)
          'no flags'
        else
          '${flags.length} flag${flags.length == 1 ? '' : 's'}',
      ].join(', '));
      lines.addAll([for (final flag in flags) '- $flag']);
    }
  }
  if (draft['repeat'] case final List repeats) {
    for (final hit in repeats) {
      if (hit is! Map) continue;
      final shared = [
        if (hit['shared'] case final List raw)
          for (final item in raw)
            if (item is String) item,
      ];
      lines.add('Repeats ${_string(hit['with']) ?? 'another draft'}'
          '${shared.isEmpty ? '' : ': ${shared.join('; ')}'}');
    }
  }
  return lines.join('\n');
}

/// The library's seeded stage tag (schema v1) for an outreach `stage` knob
/// value, so a draft files under the same stage filter as the emails typed
/// in from videos. A reply has no stage tag of its own.
String? emailStageTagForKnob(String? stage) => switch (stage) {
      'first' || 'reengage' => 'stage-initial',
      'fu1' || 'fu2' => 'stage-follow-up',
      'closing' => 'stage-closing',
      _ => null,
    };

String? _string(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;
