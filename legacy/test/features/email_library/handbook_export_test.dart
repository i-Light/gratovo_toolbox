import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/features/email_library/application/handbook_export.dart';

void main() {
  EmailRecord record({
    String subject = 'Quick question',
    String body = '',
    String critique = '',
    String context = '',
    DateTime? videoDate,
    String videoUrl = '',
    int? timecodeSeconds,
    List<String> stageTagIds = const [],
    List<String> nicheTagIds = const [],
    DateTime? lastCopiedAt,
  }) {
    final now = DateTime.utc(2026, 3, 1, 12);
    return EmailRecord(
      id: 'r-${subject.hashCode}',
      audience: EmailAudience.influencer,
      subject: subject,
      body: body,
      critique: critique,
      context: context,
      videoDate: videoDate,
      videoUrl: videoUrl,
      timecodeSeconds: timecodeSeconds,
      stageTagIds: stageTagIds,
      nicheTagIds: nicheTagIds,
      createdAt: now,
      updatedAt: now,
      lastCopiedAt: lastCopiedAt,
    );
  }

  const tagLabels = <String, EmailTag>{
    'stage-follow-up': EmailTag(
      id: 'stage-follow-up',
      kind: EmailTagKind.stage,
      label: 'Follow-up',
    ),
    'niche-fitness': EmailTag(
      id: 'niche-fitness',
      kind: EmailTagKind.niche,
      label: 'Fitness',
    ),
  };

  String export(List<EmailRecord> records) => buildHandbookExport(
        records: records,
        tagLabels: tagLabels,
        audience: EmailAudience.influencer,
        from: DateTime(2025, 6),
        to: DateTime(2025, 6, 30),
        generatedAt: DateTime(2026, 3, 2),
      );

  group('critiqueWordCount', () {
    test('counts whitespace-separated words', () {
      expect(critiqueWordCount('Too much fan energy here'), 5);
    });

    test('an empty or blank critique is zero, not one', () {
      expect(critiqueWordCount(''), 0);
      expect(critiqueWordCount('   \n  '), 0);
    });

    test('newlines and runs of spaces do not inflate the count', () {
      expect(critiqueWordCount('Weak  CTA.\n\nRewrite   it.'), 4);
    });
  });

  group('copyRecencyLabel', () {
    final now = DateTime.utc(2026, 3, 2, 10);

    test('a record that was never copied says so', () {
      expect(copyRecencyLabel(null, now: now), 'Never copied');
    });

    test('earlier the same day is today, not "0 days ago"', () {
      expect(
        copyRecencyLabel(DateTime.utc(2026, 3, 2, 1), now: now),
        'Copied today',
      );
    });

    test('late yesterday is yesterday, not "9 hours ago"', () {
      expect(
        copyRecencyLabel(DateTime.utc(2026, 3, 1, 23), now: now),
        'Copied yesterday',
      );
    });

    test('days, then months, then years', () {
      expect(
        copyRecencyLabel(DateTime.utc(2026, 2, 21), now: now),
        'Copied 9 days ago',
      );
      expect(
        copyRecencyLabel(DateTime.utc(2025, 12, 2), now: now),
        'Copied 3 months ago',
      );
      expect(
        copyRecencyLabel(DateTime.utc(2024, 1, 2), now: now),
        'Copied 2 years ago',
      );
    });

    test('singular months and years are not written as "1 months"', () {
      expect(
        copyRecencyLabel(DateTime.utc(2026, 1, 25), now: now),
        'Copied 1 month ago',
      );
      expect(
        copyRecencyLabel(DateTime.utc(2025, 2, 20), now: now),
        'Copied 1 year ago',
      );
    });

    test('a stamp from the future reads as today rather than negative', () {
      expect(
        copyRecencyLabel(DateTime.utc(2026, 3, 4), now: now),
        'Copied today',
      );
    });
  });

  group('buildHandbookExport', () {
    test('opens with a brief that names the task', () {
      final text = export([record(critique: 'Too much fan energy.')]);
      expect(text, startsWith('# Build an outreach handbook'));
    });

    test('states the range, the audience and the count', () {
      final text = export([
        record(subject: 'One', critique: 'a'),
        record(subject: 'Two', critique: 'b'),
      ]);
      expect(text, contains('Video-date range: 2025-06-01 to 2025-06-30'));
      expect(text, contains('Records in this batch: 2'));
      expect(text, contains('B2C outreach'));
    });

    test('carries every field of a record through verbatim', () {
      final text = export([
        record(
          subject: 'Collab?',
          body: 'Hi @receiver,\n\nSaw your last video.',
          context: 'Second email after no reply.',
          critique: 'The opener is fan energy. Lead with the offer.',
          videoDate: DateTime(2025, 6, 12),
          videoUrl: 'https://youtu.be/abc',
          timecodeSeconds: 2462,
          stageTagIds: const ['stage-follow-up'],
          nicheTagIds: const ['niche-fitness'],
        ),
      ]);

      expect(text, contains('### Record #1'));
      expect(text, contains('- Video date: 2025-06-12'));
      expect(text, contains('- Timecode: 41:02'));
      expect(text, contains('- Stage: Follow-up'));
      expect(text, contains('- Niche: Fitness'));
      expect(text, contains('- Source: https://youtu.be/abc'));
      expect(text, contains('Second email after no reply.'));
      expect(text, contains('Collab?'));
      expect(text, contains('Hi @receiver,\n\nSaw your last video.'));
      expect(text, contains('The opener is fan energy. Lead with the offer.'));
    });

    test('numbers records from one, in the order given', () {
      final text = export([
        record(subject: 'First', critique: 'a'),
        record(subject: 'Second', critique: 'b'),
        record(subject: 'Third', critique: 'c'),
      ]);
      expect(
        text.indexOf('### Record #1') < text.indexOf('### Record #2'),
        isTrue,
      );
      expect(text, contains('### Record #3'));
      expect(text, isNot(contains('### Record #4')));
    });

    test('a blank field is omitted rather than written as an empty block', () {
      final text = export([record(subject: 'Just a subject')]);
      expect(text, contains('**Subject:**'));
      expect(text, isNot(contains('**Body:**')));
      expect(text, isNot(contains('**Critique:**')));
      expect(text, isNot(contains('**Context:**')));
    });

    test('a tag id with no label in the map is dropped, not printed raw', () {
      final text = export([
        record(critique: 'a', nicheTagIds: const ['niche-gone']),
      ]);
      expect(text, isNot(contains('niche-gone')));
      expect(text, isNot(contains('- Niche:')));
    });

    test('a body containing a code fence does not close its own block', () {
      // The failure this guards is silent: an early fence would turn every
      // record after it into prose and nobody would see it until the handbook
      // came out wrong.
      final text = export([
        record(body: 'Try this:\n```\nnpm install\n```\nThanks', critique: 'x'),
      ]);
      expect(text, contains('````\nTry this:'));
      expect(text, contains('npm install'));
    });

    test('an empty batch still produces a usable brief', () {
      final text = export(const []);
      expect(text, startsWith('# Build an outreach handbook'));
      expect(text, contains('Records in this batch: 0'));
    });
  });

  group('resolveRecordTags', () {
    test('stage tags come before niche tags', () {
      final tags = resolveRecordTags(
        record(
          nicheTagIds: const ['niche-fitness'],
          stageTagIds: const ['stage-follow-up'],
        ),
        tagLabels,
      );
      expect([for (final t in tags) t.label], ['Follow-up', 'Fitness']);
    });
  });
}
