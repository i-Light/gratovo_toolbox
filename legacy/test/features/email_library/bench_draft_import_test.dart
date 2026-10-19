import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/features/email_library/application/bench_draft_import.dart';

/// `bench/latest.json` (the skill factory's last bench run) as library
/// records. The shape is the factory's `export_app.py` `bench_latest()`.
Map<String, Object?> _draft({
  String id = '2026-10-01T19:56/c4-brand-raidowl-A',
  Map<String, Object?> knobs = const {'reader': 'brand', 'stage': 'fu1'},
}) =>
    {
      'id': id,
      'draftId': 'c4-brand-raidowl-A',
      'case': 'c4-brand-raidowl',
      'caseTitle': 'Raid Owl · brand · follow-up',
      'variant': 'A',
      'knobs': knobs,
      'subject': 'Raid Owl for HomeRack',
      'body': 'Body text.\n\nShould I send his numbers?',
      'cards': ['core'],
      'lint': {
        'words': 52,
        'flags': [
          {'rule': 'No fan words', 'src': 'core'},
        ],
      },
      'judge': {
        'score': 7,
        'roast': 'Too stiff.',
        'fails': [
          {'rule': 'Sound human', 'why': 'reads like a form'},
        ],
        'passes': 30,
      },
      'repeat': [
        {
          'with': 'c2-gazette-roster-A',
          'shared': ['same CTA: an outline of how'],
        },
      ],
    };

void main() {
  final at = DateTime.utc(2026, 10, 2, 8);

  test('a bench draft becomes an unrated test draft', () {
    final text = jsonEncode({
      'runAt': '2026-10-01T19:56',
      'drafts': [_draft()],
    });
    final record = benchDraftRecords(text, now: at).single;
    expect(record.source, EmailRecordSource.testDraft);
    expect(record.sourceRef, '2026-10-01T19:56/c4-brand-raidowl-A');
    expect(record.audience, EmailAudience.brand);
    expect(record.stageTagIds, ['stage-follow-up']);
    expect(record.knobs, {'reader': 'brand', 'stage': 'fu1'});
    expect(record.subject, 'Raid Owl for HomeRack');
    expect(record.isUnrated, isTrue);
    expect(record.createdAt, at);
    expect(
      record.context,
      'Bench run 2026-10-01T19:56 · Raid Owl · brand · follow-up · variant A',
    );
    expect(
      record.critique,
      'Judge 7/10: Too stiff.\n'
      '- Fails "Sound human": reads like a form\n'
      'Lint: 52 words, 1 flag\n'
      '- No fan words\n'
      'Repeats c2-gazette-roster-A: same CTA: an outline of how',
    );
  });

  test('a draft with no id or body is skipped; junk is no drafts', () {
    final text = jsonEncode({
      'runAt': 'r',
      'drafts': [
        {'body': 'no id'},
        {'id': 'r/x'},
        'not a draft',
        _draft(id: 'r/ok', knobs: const {'reader': 'creator'}),
      ],
    });
    final records = benchDraftRecords(text, now: at);
    expect(records.map((r) => r.sourceRef), ['r/ok']);
    expect(records.single.audience, EmailAudience.influencer);
    expect(records.single.stageTagIds, isEmpty);
    expect(benchDraftRecords('{"drafts": ', now: at), isEmpty);
    expect(benchDraftRecords('[]', now: at), isEmpty);
  });

  test("the factory's own latest run reads in full", () {
    final file = File('data/gemini skills/outreach/bench/latest.json');
    if (!file.existsSync()) return;
    final raw = jsonDecode(file.readAsStringSync()) as Map;
    final records = benchDraftRecords(file.readAsStringSync(), now: at);
    expect(records, hasLength((raw['drafts'] as List).length));
    expect(
        records.every((r) => r.body.isNotEmpty && r.knobs.isNotEmpty), isTrue);
    expect(records.map((r) => r.sourceRef).toSet(), hasLength(records.length));
  });
}
