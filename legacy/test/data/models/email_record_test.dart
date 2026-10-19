import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';

void main() {
  group('EmailRecord.blank', () {
    test('starts from the previous record, timecode included', () {
      final blank = EmailRecord.blank(
        audience: EmailAudience.influencer,
        defaults: EmailDraftDefaults(
          videoDate: DateTime(2026, 3, 4),
          videoUrl: 'https://youtu.be/abc',
          timecodeSeconds: 3930,
          stageTagIds: const ['stage-initial'],
        ),
      );

      expect(blank.timecodeSeconds, 3930);
      expect(blank.videoUrl, 'https://youtu.be/abc');
      expect(blank.stageTagIds, ['stage-initial']);
    });

    test('a record with nothing but carried-over fields still reads as empty',
        () {
      // The property the "discard?" prompt and "save and add another" both
      // rest on: a form that has only inherited its provenance has had nothing
      // typed into it, and a carried timecode must not look like content.
      final blank = EmailRecord.blank(
        audience: EmailAudience.brand,
        defaults: const EmailDraftDefaults(
          videoUrl: 'https://youtu.be/abc',
          timecodeSeconds: 3930,
          stageTagIds: ['stage-initial'],
        ),
      );

      expect(blank.isEmpty, isTrue);
    });

    test('typing anything of substance makes it non-empty', () {
      final blank = EmailRecord.blank(audience: EmailAudience.brand);

      expect(blank.copyWith(subject: 'Hello').isEmpty, isFalse);
      expect(blank.copyWith(body: 'Hello').isEmpty, isFalse);
      expect(blank.copyWith(critique: 'Too long').isEmpty, isFalse);
      expect(blank.copyWith(context: 'From the Q3 call').isEmpty, isFalse);
      expect(blank.copyWith(nicheTagIds: const ['niche-1']).isEmpty, isFalse);
    });
  });

  group('EmailDraftDefaults', () {
    test('is empty only when every carried field is', () {
      expect(const EmailDraftDefaults().isEmpty, isTrue);
      expect(const EmailDraftDefaults(timecodeSeconds: 0).isEmpty, isFalse);
      expect(const EmailDraftDefaults(videoUrl: ' ').isEmpty, isTrue);
    });

    test('the timecode can be carried, replaced, or cleared', () {
      const defaults = EmailDraftDefaults(timecodeSeconds: 3930);

      expect(defaults.copyWith(videoUrl: 'x').timecodeSeconds, 3930);
      expect(defaults.copyWith(timecodeSeconds: 42).timecodeSeconds, 42);
      expect(defaults.copyWith(clearTimecode: true).timecodeSeconds, isNull);
    });
  });
}
