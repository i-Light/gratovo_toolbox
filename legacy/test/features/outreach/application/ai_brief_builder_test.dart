import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/features/outreach/application/ai_brief_builder.dart';

Influencer _influencer({
  String? name = 'A Channel',
  String? description = 'Weekly deep dives on self-hosting.',
  String? country = 'DE',
  int subscribers = 120000,
  List<String> relevance = const ['sponsorship mentions'],
  String? notes,
}) {
  return Influencer(
    id: 'ch_1',
    handle: '@achannel',
    channelUrl: 'https://youtube.com/@achannel',
    platform: InfluencerPlatform.youtube,
    subscriberCount: subscribers,
    sourceKeywords: const [],
    vettingStatus: VettingStatus.newlyFound,
    discoveredAt: DateTime.utc(2026),
    name: name,
    description: description,
    country: country,
    relevanceCriteria: relevance,
    notes: notes,
  );
}

Video _video(String id, {int? views, String title = 'A video'}) {
  return Video(
    id: id,
    title: title,
    url: 'https://youtube.com/watch?v=$id',
    viewCount: views,
    publishedAt: DateTime.utc(2026, 8, 14, 9),
  );
}

void main() {
  group('the brief block', () {
    test('carries the channel facts the drafter is allowed to use', () {
      final block = buildOutreachBriefData(
        influencer: _influencer(),
        videos: [_video('v1', views: 10000, title: 'Self-hosting in 2026')],
      );

      expect(block['channel_name'], 'A Channel');
      expect(block['channel_handle'], '@achannel');
      expect(block['subscriber_count'], 120000);
      expect(block['country'], 'DE');
      expect(block['last_video_title'], 'Self-hosting in 2026');
      expect(block['recent_video_titles'], ['Self-hosting in 2026']);
      expect(block['relevance_criteria'], ['sponsorship mentions']);
    });

    test('omits what it does not know rather than emitting a blank', () {
      final block = buildOutreachBriefData(
        influencer: _influencer(
          name: null,
          description: null,
          country: null,
          relevance: const [],
        ),
        videos: const [],
      );

      // A key present with a null or empty value reads to a model as a blank
      // to fill in, and a filled-in blank is an invented fact in an email.
      for (final absent in [
        'contact_name',
        'channel_description',
        'country',
        'relevance_criteria',
        'last_video_title',
        'recent_video_titles',
        'template',
        'median_views',
      ]) {
        expect(block.containsKey(absent), isFalse, reason: absent);
      }
      // The handle stands in for the name when there is no name.
      expect(block['channel_name'], '@achannel');
    });

    test('names the median as a median, and only once it is one', () {
      expect(
        medianViews([_video('a', views: 10), _video('b', views: 900)]),
        isNull,
        reason: 'two numbers are not a median, whatever they are called',
      );
      expect(
        medianViews([
          _video('a', views: 10),
          _video('b', views: 900),
          _video('c', views: 50),
        ]),
        50,
      );
      // An even count averages the middle pair rather than picking one.
      expect(
        medianViews([
          _video('a', views: 10),
          _video('b', views: 20),
          _video('c', views: 30),
          _video('d', views: 50),
        ]),
        25,
      );
      // A video with no count is not a zero.
      expect(
        medianViews([
          _video('a', views: 100),
          _video('b'),
          _video('c', views: 300),
        ]),
        isNull,
      );
    });

    test('includes the chosen template so the draft can adapt it', () {
      final block = buildOutreachBriefData(
        influencer: _influencer(),
        videos: const [],
        template: const EmailTemplate(
          id: 't1',
          name: 'Cold open',
          subject: 'Quick collab idea',
          body: 'Hi {{name}} …',
        ),
        writingRules: const ['no exclamation marks', '   '],
      );

      expect((block['template']! as Map)['name'], 'Cold open');
      expect((block['template']! as Map)['subject'], 'Quick collab idea');
      expect(block['writing_rules'], ['no exclamation marks'],
          reason: 'a blank rule is not a rule');
    });
  });

  group('the readable sections', () {
    test('group the block the way somebody reads a channel', () {
      final sections = outreachBriefSections(
        buildOutreachBriefData(
          influencer: _influencer(notes: 'replied to a cold email in March'),
          videos: [_video('v1', views: 10000, title: 'Self-hosting in 2026')],
        ),
      );

      expect(
        [for (final section in sections) section.id],
        [
          briefSectionChannel,
          briefSectionAudience,
          briefSectionLatestUpload,
          briefSectionRecentUploads,
          briefSectionFit,
        ],
        reason: 'no draft section: nothing was drafting with a template here',
      );

      final channel = sections.first;
      expect(
        [for (final field in channel.fields) field.key],
        [
          'channel_name',
          'channel_handle',
          'contact_name',
          'country',
          'channel_url',
          'channel_description',
        ],
        reason: 'the section order is the payload order, not map order',
      );
    });

    test('flatten the template and never invent an empty row', () {
      final sections = outreachBriefSections(
        buildOutreachBriefData(
          influencer: _influencer(
            name: null,
            description: null,
            country: null,
            relevance: const [],
          ),
          videos: const [],
          template: const EmailTemplate(
            id: 't1',
            name: 'Cold open',
            subject: '   ',
            body: 'Hi there',
          ),
          writingRules: const ['no exclamation marks'],
        ),
      );

      final byId = <String, BriefSection>{
        for (final section in sections) section.id: section,
      };
      expect(byId.keys, containsAll([briefSectionChannel, briefSectionDraft]));
      expect(byId[briefSectionLatestUpload], isNull);
      expect(
        [for (final field in byId[briefSectionDraft]!.fields) field.key],
        ['writing_rules', 'template_name', 'template_body'],
        reason: 'the template had no subject, so there is no subject row',
      );
    });

    test('show a field this layout has not been taught about', () {
      final sections = outreachBriefSections(const {
        'channel_handle': '@achannel',
        'something_new': 'a value',
      });

      final other = sections.last;
      expect(other.id, briefSectionOther);
      expect(other.fields.single.key, 'something_new');
    });
  });

  test('the prompt asks for the read as well as the email', () {
    // The email was always the point; the read is what makes it editable.
    expect(outreachBriefInstructions, contains('PART 1'));
    expect(outreachBriefInstructions, contains('Weak point:'));
    expect(
      outreachBriefInstructions,
      isNot(contains('{')),
      reason: 'the first brace in a brief is where the JSON payload starts',
    );
  });

  test('the rendered brief is instructions followed by parseable JSON', () {
    final text = buildOutreachBrief(
      influencer: _influencer(),
      videos: [_video('v1', views: 5000)],
    );

    expect(text,
        startsWith(outreachBriefInstructions.trimLeft().split('\n').first));

    final start = text.indexOf('{');
    expect(start, greaterThan(0), reason: 'the instructions come first');
    final decoded = jsonDecode(text.substring(start)) as Map<String, dynamic>;
    expect(decoded['channel_handle'], '@achannel');
  });
}
