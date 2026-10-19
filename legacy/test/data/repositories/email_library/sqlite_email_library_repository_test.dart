import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/sqlite_email_library_repository.dart';

import 'memory_local_db.dart';

void main() {
  late MemoryLocalDb db;
  late SqliteEmailLibraryRepository repository;

  setUp(() {
    db = MemoryLocalDb();
    repository = SqliteEmailLibraryRepository(db);
  });

  tearDown(() => db.close());

  EmailRecord record({
    EmailAudience audience = EmailAudience.influencer,
    String subject = 'Quick question',
    String body = '',
    String critique = '',
    String context = '',
    DateTime? videoDate,
    String videoUrl = '',
    int? timecodeSeconds,
    List<String> stageTagIds = const [],
    List<String> nicheTagIds = const [],
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    final now = DateTime.utc(2026, 3, 1, 12);
    return EmailRecord(
      id: 'r-${subject.hashCode}-${audience.storageValue}',
      audience: audience,
      subject: subject,
      body: body,
      critique: critique,
      context: context,
      videoDate: videoDate,
      videoUrl: videoUrl,
      timecodeSeconds: timecodeSeconds,
      stageTagIds: stageTagIds,
      nicheTagIds: nicheTagIds,
      createdAt: createdAt ?? now,
      updatedAt: updatedAt ?? createdAt ?? now,
    );
  }

  group('the seeded stage vocabulary', () {
    test('is there on first open, in sequence order', () async {
      final stages = await repository.listTags(EmailTagKind.stage);
      expect(
        stages.map((t) => t.label),
        ['Initial cold outreach', 'Follow-up', 'Closing'],
      );
    });

    test('the niche vocabulary starts empty', () async {
      expect(await repository.listTags(EmailTagKind.niche), isEmpty);
    });

    test('the @ placeholders are seeded too', () async {
      final placeholders = await repository.listTags(EmailTagKind.placeholder);
      expect(
        placeholders.map((t) => t.label),
        ['receiver', 'sender', 'creator', 'brand', 'product'],
      );
    });

    test('a placeholder added later joins them', () async {
      await repository.addTag(
        kind: EmailTagKind.placeholder,
        label: 'campaign',
      );
      expect(
        await repository.listTags(EmailTagKind.placeholder),
        hasLength(6),
      );
      // The vocabularies do not leak into each other: a keyword is not a tag
      // anything can be filed under.
      expect(await repository.listTags(EmailTagKind.niche), isEmpty);
    });
  });

  group('records', () {
    test('round-trip every field', () async {
      final saved = record(
        subject: 'Your Blender tutorial',
        body: 'Line one\n\nLine two',
        critique: 'Opens on the sender, not the reader.',
        context: 'First contact, no prior reply.',
        videoDate: DateTime(2025, 11, 4),
        videoUrl: 'https://youtu.be/abc',
        timecodeSeconds: 3930,
        stageTagIds: const ['stage-initial'],
      );
      await repository.saveRecord(saved);

      final read = await repository.getRecord(saved.id);
      expect(read, isNotNull);
      expect(read!.subject, 'Your Blender tutorial');
      expect(read.body, 'Line one\n\nLine two');
      expect(read.critique, 'Opens on the sender, not the reader.');
      expect(read.context, 'First contact, no prior reply.');
      expect(read.videoDate, DateTime(2025, 11, 4));
      expect(read.videoUrl, 'https://youtu.be/abc');
      expect(read.timecodeSeconds, 3930);
      expect(read.stageTagIds, ['stage-initial']);
      expect(read.nicheTagIds, isEmpty);
    });

    test('a second save of the same id updates rather than duplicates',
        () async {
      final first = record(critique: 'Too long.');
      await repository.saveRecord(first);
      await repository.saveRecord(first.copyWith(critique: 'Much better.'));

      final all =
          await repository.listRecords(audience: EmailAudience.influencer);
      expect(all, hasLength(1));
      expect(all.single.critique, 'Much better.');
    });

    test('tags are replaced, not accumulated, on re-save', () async {
      final niche = await repository.addTag(
        kind: EmailTagKind.niche,
        label: 'Fitness',
      );
      final saved = record(
        stageTagIds: const ['stage-initial'],
        nicheTagIds: [niche.id],
      );
      await repository.saveRecord(saved);
      await repository.saveRecord(
        saved.copyWith(
            stageTagIds: const ['stage-closing'], nicheTagIds: const []),
      );

      final read = await repository.getRecord(saved.id);
      expect(read!.stageTagIds, ['stage-closing']);
      expect(read.nicheTagIds, isEmpty);
    });

    test('the two audiences are separate corpora', () async {
      await repository.saveRecord(record(audience: EmailAudience.influencer));
      await repository.saveRecord(
        record(audience: EmailAudience.brand, subject: 'Partnership'),
      );

      final influencers =
          await repository.listRecords(audience: EmailAudience.influencer);
      final brands =
          await repository.listRecords(audience: EmailAudience.brand);
      expect(influencers, hasLength(1));
      expect(brands, hasLength(1));
      expect(brands.single.subject, 'Partnership');

      expect(await repository.countRecords(), {
        EmailAudience.influencer: 1,
        EmailAudience.brand: 1,
      });
    });

    group('sort', () {
      setUp(() async {
        await repository.saveRecord(record(
          subject: 'A',
          videoDate: DateTime(2025, 1, 10),
          createdAt: DateTime.utc(2026, 3, 1),
          updatedAt: DateTime.utc(2026, 3, 9),
        ));
        await repository.saveRecord(record(
          subject: 'B',
          videoDate: DateTime(2025, 6, 2),
          createdAt: DateTime.utc(2026, 3, 5),
          updatedAt: DateTime.utc(2026, 3, 5),
        ));
        await repository.saveRecord(record(
          subject: 'C',
          createdAt: DateTime.utc(2026, 3, 3),
          updatedAt: DateTime.utc(2026, 3, 7),
        ));
      });

      Future<List<String>> subjectsBy(EmailRecordSort sort) async => [
            for (final r in await repository.listRecords(
              audience: EmailAudience.influencer,
              sort: sort,
            ))
              r.subject,
          ];

      test('lastEdited is newest updated_at first, and is the default',
          () async {
        expect(await subjectsBy(EmailRecordSort.lastEdited), ['A', 'C', 'B']);
        expect(
          [
            for (final r in await repository.listRecords(
              audience: EmailAudience.influencer,
            ))
              r.subject,
          ],
          ['A', 'C', 'B'],
        );
      });

      test('lastCreated is newest created_at first', () async {
        expect(await subjectsBy(EmailRecordSort.lastCreated), ['B', 'C', 'A']);
      });

      test('videoDate is newest video first, dateless records last', () async {
        expect(await subjectsBy(EmailRecordSort.videoDate), ['B', 'A', 'C']);
      });

      test('videoDate breaks a shared date by timecode, descending', () async {
        // Two more emails from B's video, at different moments in it.
        await repository.saveRecord(record(
          subject: 'B-late',
          videoDate: DateTime(2025, 6, 2),
          timecodeSeconds: 900,
        ));
        await repository.saveRecord(record(
          subject: 'B-early',
          videoDate: DateTime(2025, 6, 2),
          timecodeSeconds: 120,
        ));

        // Within 2025-06-02: earliest timecode first, then the one with no
        // recorded moment (B). Then the older video, then the dateless record.
        expect(
          await subjectsBy(EmailRecordSort.videoDate),
          ['B-late', 'B-early', 'B', 'A', 'C'],
        );
      });
    });

    test('deleting a record takes its tag rows with it', () async {
      final saved = record(stageTagIds: const ['stage-initial']);
      await repository.saveRecord(saved);
      await repository.deleteRecord(saved.id);

      expect(await repository.getRecord(saved.id), isNull);
      expect(
        db.select('SELECT count(*) AS n FROM email_record_tags').single['n'],
        0,
      );
      // The vocabulary itself survives — deleting one record must not empty it.
      expect(await repository.listTags(EmailTagKind.stage), hasLength(3));
    });
  });

  group('listRecords filtering', () {
    setUp(() async {
      await repository.saveRecord(record(
        subject: 'Cold open',
        critique: 'Weak specificity.',
        stageTagIds: const ['stage-initial'],
      ));
      await repository.saveRecord(record(
        subject: 'Bump',
        body: 'Circling back on my last note.',
        stageTagIds: const ['stage-follow-up'],
      ));
    });

    test('search covers subject, body, context and critique', () async {
      Future<List<String>> subjectsFor(String term) async => [
            for (final r in await repository.listRecords(
              audience: EmailAudience.influencer,
              search: term,
            ))
              r.subject,
          ];

      expect(await subjectsFor('cold'), ['Cold open']);
      expect(await subjectsFor('circling'), ['Bump']);
      expect(await subjectsFor('specificity'), ['Cold open']);
      expect(await subjectsFor('nothing here'), isEmpty);
    });

    test('a wildcard typed into search is a literal, not a wildcard', () async {
      // Without the ESCAPE clause, '%' would match every record in the tab.
      expect(
        await repository.listRecords(
          audience: EmailAudience.influencer,
          search: '%',
        ),
        isEmpty,
      );

      await repository.saveRecord(record(
        subject: 'Open rate',
        body: 'It sat at 40% for a month.',
      ));
      expect(
        (await repository.listRecords(
          audience: EmailAudience.influencer,
          search: '40%',
        ))
            .map((r) => r.subject),
        ['Open rate'],
      );
    });

    test('two tags mean AND, not OR', () async {
      final niche = await repository.addTag(
        kind: EmailTagKind.niche,
        label: 'Fitness',
      );
      await repository.saveRecord(record(
        subject: 'Cold open',
        critique: 'Weak specificity.',
        stageTagIds: const ['stage-initial'],
        nicheTagIds: [niche.id],
      ));

      final both = await repository.listRecords(
        audience: EmailAudience.influencer,
        stageTagIds: const ['stage-initial'],
        nicheTagIds: [niche.id],
      );
      expect(both.map((r) => r.subject), ['Cold open']);

      final mismatched = await repository.listRecords(
        audience: EmailAudience.influencer,
        stageTagIds: const ['stage-follow-up'],
        nicheTagIds: [niche.id],
      );
      expect(mismatched, isEmpty);
    });
  });

  group('tags', () {
    test('adding an existing label under any casing returns the same tag',
        () async {
      final first =
          await repository.addTag(kind: EmailTagKind.niche, label: 'Fitness');
      final again = await repository.addTag(
          kind: EmailTagKind.niche, label: '  fitness ');

      expect(again.id, first.id);
      expect(await repository.listTags(EmailTagKind.niche), hasLength(1));
    });

    test('the same label in two vocabularies is two tags', () async {
      final niche =
          await repository.addTag(kind: EmailTagKind.niche, label: 'Closing');
      expect(niche.id, isNot('stage-closing'));
      expect(await repository.listTags(EmailTagKind.niche), hasLength(1));
      expect(await repository.listTags(EmailTagKind.stage), hasLength(3));
    });

    test('new tags sort after the ones already there', () async {
      await repository.addTag(kind: EmailTagKind.stage, label: 'Breakup');
      final stages = await repository.listTags(EmailTagKind.stage);
      expect(stages.last.label, 'Breakup');
    });

    test('deleting a tag strips it from every record', () async {
      final niche =
          await repository.addTag(kind: EmailTagKind.niche, label: 'Fitness');
      await repository.saveRecord(record(nicheTagIds: [niche.id]));
      expect(
          await repository.tagUsageCounts(EmailTagKind.niche), {niche.id: 1});

      await repository.deleteTag(niche.id);

      expect(await repository.listTags(EmailTagKind.niche), isEmpty);
      final all =
          await repository.listRecords(audience: EmailAudience.influencer);
      expect(all.single.nicheTagIds, isEmpty);
    });

    test('renaming keeps the id, so records keep their tag', () async {
      final niche =
          await repository.addTag(kind: EmailTagKind.niche, label: 'Fitness');
      await repository.saveRecord(record(nicheTagIds: [niche.id]));

      await repository.renameTag(niche.id, 'Health & fitness');

      final tags = await repository.listTags(EmailTagKind.niche);
      expect(tags.single.label, 'Health & fitness');
      final all =
          await repository.listRecords(audience: EmailAudience.influencer);
      expect(all.single.nicheTagIds, [niche.id]);
    });

    test('a rename to blank is refused rather than emptying the label',
        () async {
      final niche =
          await repository.addTag(kind: EmailTagKind.niche, label: 'Fitness');
      await repository.renameTag(niche.id, '   ');
      expect(
        (await repository.listTags(EmailTagKind.niche)).single.label,
        'Fitness',
      );
    });
  });

  group('sticky defaults', () {
    test('are per audience, and start empty', () async {
      expect(
        (await repository.readDefaults(EmailAudience.influencer)).isEmpty,
        isTrue,
      );

      await repository.writeDefaults(
        EmailAudience.influencer,
        EmailDraftDefaults(
          videoDate: DateTime(2025, 11, 4),
          videoUrl: 'https://youtu.be/abc',
        ),
      );

      final influencer =
          await repository.readDefaults(EmailAudience.influencer);
      expect(influencer.videoDate, DateTime(2025, 11, 4));
      expect(influencer.videoUrl, 'https://youtu.be/abc');

      // The brand tab is untouched — one tab's video must not become the
      // other's.
      expect(
          (await repository.readDefaults(EmailAudience.brand)).isEmpty, isTrue);
    });

    test('a second write replaces rather than failing on the primary key',
        () async {
      await repository.writeDefaults(
        EmailAudience.brand,
        const EmailDraftDefaults(videoUrl: 'https://one'),
      );
      await repository.writeDefaults(
        EmailAudience.brand,
        const EmailDraftDefaults(videoUrl: 'https://two'),
      );
      expect(
        (await repository.readDefaults(EmailAudience.brand)).videoUrl,
        'https://two',
      );
    });

    test('carry the stage tag forward, and let it be cleared again', () async {
      await repository.writeDefaults(
        EmailAudience.influencer,
        const EmailDraftDefaults(stageTagIds: ['stage-initial']),
      );
      expect(
        (await repository.readDefaults(EmailAudience.influencer)).stageTagIds,
        ['stage-initial'],
      );

      // A later record with no stage tag resets the default rather than
      // leaving the old one to reattach itself to everything after it.
      await repository.writeDefaults(
        EmailAudience.influencer,
        const EmailDraftDefaults(),
      );
      expect(
        (await repository.readDefaults(EmailAudience.influencer)).stageTagIds,
        isEmpty,
      );
    });

    test('carry the timecode forward', () async {
      await repository.writeDefaults(
        EmailAudience.influencer,
        const EmailDraftDefaults(timecodeSeconds: 3930),
      );
      expect(
        (await repository.readDefaults(EmailAudience.influencer))
            .timecodeSeconds,
        3930,
      );
    });

    test('a timecode of zero survives, and is not "no timecode"', () async {
      // The start of a video is a real position, so the column is nullable
      // rather than defaulting — 0 and null have to stay different.
      await repository.writeDefaults(
        EmailAudience.brand,
        const EmailDraftDefaults(timecodeSeconds: 0),
      );
      expect(
        (await repository.readDefaults(EmailAudience.brand)).timecodeSeconds,
        0,
      );

      await repository.writeDefaults(
        EmailAudience.brand,
        const EmailDraftDefaults(),
      );
      expect(
        (await repository.readDefaults(EmailAudience.brand)).timecodeSeconds,
        isNull,
      );
    });
  });

  group('listRecordsInVideoDateRange', () {
    setUp(() async {
      await repository.saveRecord(record(
        subject: 'Before',
        videoDate: DateTime(2025, 5, 31),
      ));
      await repository.saveRecord(record(
        subject: 'On the first day',
        videoDate: DateTime(2025, 6, 1),
      ));
      await repository.saveRecord(record(
        subject: 'On the last day',
        videoDate: DateTime(2025, 6, 30),
      ));
      await repository.saveRecord(record(
        subject: 'After',
        videoDate: DateTime(2025, 7, 1),
      ));
      await repository.saveRecord(record(subject: 'Dateless'));
      await repository.saveRecord(record(
        subject: 'A brand email',
        audience: EmailAudience.brand,
        videoDate: DateTime(2025, 6, 15),
      ));
    });

    Future<List<String>> subjectsIn(DateTime from, DateTime to) async {
      final found = await repository.listRecordsInVideoDateRange(
        audience: EmailAudience.influencer,
        from: from,
        to: to,
      );
      return [for (final r in found) r.subject];
    }

    test('both ends are inclusive', () async {
      expect(
        await subjectsIn(DateTime(2025, 6), DateTime(2025, 6, 30)),
        ['On the first day', 'On the last day'],
      );
    });

    test('records with no video date are in no range', () async {
      // Not even a range wide enough to hold every date there is.
      expect(
        await subjectsIn(DateTime(1900), DateTime(2100)),
        isNot(contains('Dateless')),
      );
    });

    test('the other tab is a separate corpus here too', () async {
      expect(
        await subjectsIn(DateTime(2025, 6), DateTime(2025, 6, 30)),
        isNot(contains('A brand email')),
      );
      final brands = await repository.listRecordsInVideoDateRange(
        audience: EmailAudience.brand,
        from: DateTime(2025, 6),
        to: DateTime(2025, 6, 30),
      );
      expect([for (final r in brands) r.subject], ['A brand email']);
    });

    test('oldest first — the opposite of the on-screen list', () async {
      expect(
        await subjectsIn(DateTime(1900), DateTime(2100)),
        ['Before', 'On the first day', 'On the last day', 'After'],
      );
    });

    test('one day is read in timecode order', () async {
      await repository.saveRecord(record(
        subject: 'Later in the video',
        videoDate: DateTime(2025, 6, 10),
        timecodeSeconds: 900,
      ));
      await repository.saveRecord(record(
        subject: 'Earlier in the video',
        videoDate: DateTime(2025, 6, 10),
        timecodeSeconds: 120,
      ));

      expect(
        await subjectsIn(DateTime(2025, 6, 10), DateTime(2025, 6, 10)),
        ['Later in the video', 'Earlier in the video'],
      );
    });

    test('an inverted range is empty rather than an error', () async {
      expect(await subjectsIn(DateTime(2025, 6, 30), DateTime(2025, 6)), []);
    });
  });

  group('videoDateBounds', () {
    test('is the oldest and newest video date in the tab', () async {
      await repository.saveRecord(record(
        subject: 'Middle',
        videoDate: DateTime(2025, 6, 15),
      ));
      await repository.saveRecord(record(
        subject: 'Oldest',
        videoDate: DateTime(2025, 5, 31),
      ));
      await repository.saveRecord(record(
        subject: 'Newest',
        videoDate: DateTime(2025, 7, 1),
      ));

      final bounds = await repository.videoDateBounds(
        EmailAudience.influencer,
      );
      expect(bounds!.earliest, DateTime(2025, 5, 31));
      expect(bounds.latest, DateTime(2025, 7, 1));
    });

    test('records with no video date neither widen it nor blank it', () async {
      await repository.saveRecord(record(subject: 'Dateless'));
      await repository.saveRecord(record(
        subject: 'Dated',
        videoDate: DateTime(2025, 6, 15),
      ));

      // MIN and MAX skip NULLs; a dateless record must not drag either end to
      // nowhere, and must not make a tab that has dates look like it has none.
      final bounds = await repository.videoDateBounds(
        EmailAudience.influencer,
      );
      expect(bounds!.earliest, DateTime(2025, 6, 15));
      expect(bounds.latest, DateTime(2025, 6, 15));
    });

    test('a tab with nothing dated in it has no bounds at all', () async {
      await repository.saveRecord(record(subject: 'Dateless'));
      expect(
        await repository.videoDateBounds(EmailAudience.influencer),
        isNull,
      );
    });

    test('an empty tab has no bounds', () async {
      expect(await repository.videoDateBounds(EmailAudience.brand), isNull);
    });

    test('the other tab is a separate corpus here too', () async {
      await repository.saveRecord(record(
        subject: 'An influencer email',
        videoDate: DateTime(2025, 6, 15),
      ));
      await repository.saveRecord(record(
        subject: 'A brand email',
        audience: EmailAudience.brand,
        videoDate: DateTime(2024, 1, 20),
      ));

      final brands = await repository.videoDateBounds(EmailAudience.brand);
      expect(brands!.earliest, DateTime(2024, 1, 20));
      expect(brands.latest, DateTime(2024, 1, 20));
    });
  });

  group('markRecordsCopied', () {
    test('a record starts having never been copied', () async {
      final saved = record(subject: 'Fresh');
      await repository.saveRecord(saved);
      expect((await repository.getRecord(saved.id))!.lastCopiedAt, isNull);
    });

    test('stamps every id in the batch with the same instant', () async {
      final first = record(subject: 'One');
      final second = record(subject: 'Two');
      final untouched = record(subject: 'Three');
      for (final r in [first, second, untouched]) {
        await repository.saveRecord(r);
      }

      final at = DateTime.utc(2026, 4, 2, 9, 30);
      await repository.markRecordsCopied([first.id, second.id], at);

      expect((await repository.getRecord(first.id))!.lastCopiedAt, at);
      expect((await repository.getRecord(second.id))!.lastCopiedAt, at);
      expect((await repository.getRecord(untouched.id))!.lastCopiedAt, isNull);
    });

    test('an id that is not in the library is ignored, not an error', () async {
      final saved = record(subject: 'Real');
      await repository.saveRecord(saved);

      final at = DateTime.utc(2026, 4, 2);
      await expectLater(
        repository.markRecordsCopied([saved.id, 'no-such-record'], at),
        completes,
      );
      expect((await repository.getRecord(saved.id))!.lastCopiedAt, at);
    });

    test('an empty batch touches nothing', () async {
      final saved = record(subject: 'Real');
      await repository.saveRecord(saved);
      await repository.markRecordsCopied(const [], DateTime.utc(2026, 4, 2));
      expect((await repository.getRecord(saved.id))!.lastCopiedAt, isNull);
    });

    test('a later copy replaces the earlier one', () async {
      final saved = record(subject: 'Twice');
      await repository.saveRecord(saved);

      await repository.markRecordsCopied([saved.id], DateTime.utc(2026, 1, 5));
      await repository.markRecordsCopied([saved.id], DateTime.utc(2026, 3, 9));

      expect(
        (await repository.getRecord(saved.id))!.lastCopiedAt,
        DateTime.utc(2026, 3, 9),
      );
    });

    test('editing the record afterwards keeps its copy history', () async {
      // The reason `saveRecord` does not name the column: an edit must never
      // be able to rewrite what a copy recorded.
      final saved = record(subject: 'Edited later');
      await repository.saveRecord(saved);

      final at = DateTime.utc(2026, 2, 14);
      await repository.markRecordsCopied([saved.id], at);

      final reloaded = (await repository.getRecord(saved.id))!;
      await repository.saveRecord(
        reloaded.copyWith(critique: 'A much better critique'),
      );

      final after = (await repository.getRecord(saved.id))!;
      expect(after.critique, 'A much better critique');
      expect(after.lastCopiedAt, at);
    });

    test('the range query carries the stamp through', () async {
      final saved = record(subject: 'Dated', videoDate: DateTime(2025, 6, 10));
      await repository.saveRecord(saved);

      final at = DateTime.utc(2026, 5, 1);
      await repository.markRecordsCopied([saved.id], at);

      final found = await repository.listRecordsInVideoDateRange(
        audience: EmailAudience.influencer,
        from: DateTime(2025, 6),
        to: DateTime(2025, 6, 30),
      );
      expect(found.single.lastCopiedAt, at);
    });
  });

  group('drafts and verdicts (schema v6)', () {
    EmailRecord draft(String ref, {EmailVerdict? verdict}) => EmailRecord(
          id: 'd-$ref',
          audience: EmailAudience.influencer,
          subject: 'S $ref',
          body: 'B $ref',
          stageTagIds: const ['stage-initial'],
          createdAt: DateTime.utc(2026, 10, 2),
          updatedAt: DateTime.utc(2026, 10, 2),
          source: EmailRecordSource.testDraft,
          sourceRef: '2026-10-01T19:56/$ref',
          knobs: const {'reader': 'creator', 'stage': 'first'},
          facts: const {'creator': 'Andrew', 'views': 49000},
          verdict: verdict,
          verdictNote: verdict == null ? '' : 'why',
          verdictAt: verdict == null ? null : DateTime.utc(2026, 10, 2, 9),
        );

    test('the columns are the ones the factory reads', () {
      // pipeline/tools/email_library.py VERDICT_COLUMNS: a rename on either
      // side and the factory silently sees no verdicts.
      final columns = {
        for (final row in db.select('PRAGMA table_info(email_records)'))
          row['name'],
      };
      expect(
          columns,
          containsAll(const [
            'verdict', 'verdict_note', 'source', 'knobs', 'facts', 'source_ref',
            'verdict_at', //
          ]));
    });

    test('a draft round-trips with its knobs, facts and verdict', () async {
      await repository.saveRecord(draft('a', verdict: EmailVerdict.bad));
      final back = (await repository.getRecord('d-a'))!;
      expect(back.source, EmailRecordSource.testDraft);
      expect(back.sourceRef, '2026-10-01T19:56/a');
      expect(back.knobs, {'reader': 'creator', 'stage': 'first'});
      expect(back.facts, {'creator': 'Andrew', 'views': 49000});
      expect(back.verdict, EmailVerdict.bad);
      expect(back.verdictNote, 'why');
      expect(back.verdictAt, DateTime.utc(2026, 10, 2, 9));
      // Stored the way the factory parses them: JSON objects, plain values.
      final row = db
          .select(
              "SELECT knobs, verdict, source FROM email_records WHERE id = 'd-a'")
          .single;
      expect(row['knobs'], '{"reader":"creator","stage":"first"}');
      expect(row['verdict'], 'bad');
      expect(row['source'], 'test-draft');
    });

    test('a record from before v6 reads as an unrated video record', () async {
      await repository.saveRecord(record(subject: 'old'));
      final back =
          (await repository.listRecords(audience: EmailAudience.influencer))
              .single;
      expect(back.source, EmailRecordSource.video);
      expect(back.verdict, isNull);
      expect(back.isUnrated, isFalse);
      expect(back.knobs, isEmpty);
    });

    test('importRecords adds a bench run once and keeps verdicts', () async {
      expect(await repository.importRecords([draft('a'), draft('b')]), 2);
      // Rated in the app, then the same run imported again: nothing new, and
      // the verdict is not overwritten by the file's unrated copy.
      final a = (await repository.getRecord('d-a'))!;
      await repository.saveRecord(a.copyWith(verdict: EmailVerdict.good));
      final again = [
        for (final r in [draft('a'), draft('b'), draft('c')])
          EmailRecord(
            id: '${r.id}-second-import',
            audience: r.audience,
            body: r.body,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            source: r.source,
            sourceRef: r.sourceRef,
          ),
      ];
      expect(await repository.importRecords(again), 1);
      final all =
          await repository.listRecords(audience: EmailAudience.influencer);
      expect(all, hasLength(3));
      expect(
        all.firstWhere((r) => r.id == 'd-a').verdict,
        EmailVerdict.good,
      );
      // Tags come in with the import.
      expect(
          all.firstWhere((r) => r.id == 'd-b').stageTagIds, ['stage-initial']);
    });

    test('listRecords narrows to one source', () async {
      await repository.saveRecord(record(subject: 'video one'));
      await repository.saveRecord(draft('a'));
      final drafts = await repository.listRecords(
        audience: EmailAudience.influencer,
        source: EmailRecordSource.testDraft,
      );
      expect(drafts.map((r) => r.id), ['d-a']);
      final videos = await repository.listRecords(
        audience: EmailAudience.influencer,
        source: EmailRecordSource.video,
      );
      expect(videos.map((r) => r.subject), ['video one']);
    });

    test('a knobs cell that is not JSON reads as none', () async {
      await repository.saveRecord(draft('a'));
      db.execute("UPDATE email_records SET knobs = 'not json', "
          "facts = '[1]' WHERE id = 'd-a'");
      final back = (await repository.getRecord('d-a'))!;
      expect(back.knobs, isEmpty);
      expect(back.facts, isEmpty);
    });
  });
}
