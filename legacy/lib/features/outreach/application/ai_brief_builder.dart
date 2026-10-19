import 'dart:convert';

import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/video.dart';

/// Builds the paste-into-an-AI brief for one channel: an instruction block
/// followed by that channel's research as JSON.
///
/// This is the in-app version of `pipeline/tools/outreach_block.py`, and it
/// exists for the same reason that tool did: the best drafts come out of a
/// model the app does not host — whatever chat window somebody already has
/// open — and the slow part of using one is assembling the channel's facts by
/// hand. The app already holds those facts, so it can hand over a block that
/// is ready to paste.
///
/// Two rules are carried over from the Python tool verbatim, because both of
/// them are about not fabricating things:
///
///  * **Absent fields are omitted, never emitted as null or "unknown".** A
///    model reading `"country": null` treats it as a blank to fill in, and a
///    filled-in blank is an invented fact in an email. A missing key reads as
///    "do not mention this".
///  * **A metric is named after how it was computed.** [medianViews] is a
///    median, not a mean, because one viral upload makes a mean that
///    misrepresents what a brand would actually be buying — and the
///    instruction block tells the model to quote it under that same name.
String buildOutreachBrief({
  required Influencer influencer,
  required List<Video> videos,
  EmailTemplate? template,
  List<String> writingRules = const [],
  String? senderName,
}) {
  final block = buildOutreachBriefData(
    influencer: influencer,
    videos: videos,
    template: template,
    writingRules: writingRules,
    senderName: senderName,
  );
  return renderOutreachBrief(block);
}

/// The clipboard payload for an already-built [block]: the instructions, then
/// the data as indented JSON.
///
/// Split out so a caller that also needs the block itself — to show it to the
/// person doing the drafting, see [outreachBriefSections] — builds it once and
/// renders from the same map, rather than assembling the channel's facts twice
/// and hoping the two agree.
String renderOutreachBrief(Map<String, Object?> block) {
  final json = const JsonEncoder.withIndent('  ').convert(block);
  return '$outreachBriefInstructions\n\n$json\n';
}

/// The JSON half of the brief, as a map — separated from [buildOutreachBrief]
/// so it can be asserted on field by field rather than through a rendered
/// string.
Map<String, Object?> buildOutreachBriefData({
  required Influencer influencer,
  required List<Video> videos,
  EmailTemplate? template,
  List<String> writingRules = const [],
  String? senderName,
}) {
  final block = <String, Object?>{
    'channel_name': influencer.name ?? influencer.handle,
    'channel_handle': influencer.handle,
  };

  void put(String key, Object? value) {
    if (value == null) return;
    if (value is String && value.trim().isEmpty) return;
    if (value is Iterable && value.isEmpty) return;
    block[key] = value is String ? value.trim() : value;
  }

  put('contact_name', influencer.name);
  put('sender_name', senderName);
  put('channel_description', influencer.description);
  put('channel_url', influencer.channelUrl);
  if (influencer.subscriberCount > 0) {
    block['subscriber_count'] = influencer.subscriberCount;
  }
  put('country', influencer.country);

  final median = medianViews(videos);
  if (median != null) block['median_views'] = median;

  // The newest upload with a known publish date, falling back to whatever is
  // first — `getRecentVideos` already returns newest first, and a channel
  // whose dates all failed to fetch still has a latest video worth naming.
  final latest = videos.isEmpty ? null : videos.first;
  if (latest != null) {
    put('last_video_title', latest.title);
    put('last_video_description', latest.description);
    put('last_video_url', latest.url);
    if (latest.publishedAt != null) {
      block['last_video_published_at'] =
          latest.publishedAt!.toUtc().toIso8601String();
    }
    if (latest.viewCount != null) {
      block['last_video_views'] = latest.viewCount;
    }
  }

  put('recent_video_titles', [
    for (final video in videos.take(5))
      if (video.title.trim().isNotEmpty) video.title.trim(),
  ]);
  put('relevance_criteria', influencer.relevanceCriteria);
  put('notes', influencer.notes);
  put('writing_rules', [
    for (final rule in writingRules)
      if (rule.trim().isNotEmpty) rule.trim(),
  ]);

  if (template != null) {
    put('template', <String, Object?>{
      'name': template.name,
      if (template.subject.trim().isNotEmpty) 'subject': template.subject,
      'body': template.body,
    });
  }

  return block;
}

/// The median view count across [videos], or null when fewer than three of
/// them have a count at all.
///
/// Three is the same floor the Python tool uses: below it the "median" is one
/// or two numbers wearing a statistic's name, and the honest move is to say
/// nothing and let the offer lean on subscriber count instead.
int? medianViews(List<Video> videos) {
  final counts = <int>[
    for (final video in videos)
      if (video.viewCount != null) video.viewCount!,
  ]..sort();
  if (counts.length < 3) return null;
  final middle = counts.length ~/ 2;
  if (counts.length.isOdd) return counts[middle];
  return ((counts[middle - 1] + counts[middle]) / 2).round();
}

/// The same block, regrouped for a person to read.
///
/// The clipboard payload is JSON because a model reads JSON well and a person
/// reads it badly — and the person is the one who has to decide whether the
/// draft that comes back is worth sending. These sections are that same data
/// with nothing added: the dialog that shows them (ai_brief_dialog.dart) only
/// supplies the labels, so a field that is absent from the block is absent
/// here too and nothing invents a blank for it.
///
/// Ordered the way somebody reads a channel: who they are, how big, what they
/// last posted, why we picked them, and what we are drafting with. Sections
/// with no data at all are dropped rather than shown empty.
List<BriefSection> outreachBriefSections(Map<String, Object?> data) {
  final remaining = Map<String, Object?>.of(data);

  // `template` is the one nested value in the block. Flattened here so the
  // view can stay a flat label-and-value renderer.
  final template = remaining.remove('template');
  if (template is Map) {
    for (final key in const ['name', 'subject', 'body']) {
      final value = template[key];
      if (value != null) remaining['template_$key'] = value;
    }
  }

  final sections = <BriefSection>[];
  for (final entry in _briefSectionKeys.entries) {
    final fields = <BriefField>[
      for (final key in entry.value)
        if (remaining.containsKey(key)) BriefField(key, remaining.remove(key)),
    ];
    if (fields.isNotEmpty) sections.add(BriefSection(entry.key, fields));
  }

  // Anything the block grew that this layout has not been taught about still
  // reaches the reader, under its raw key, rather than disappearing from the
  // view while sitting in the payload.
  if (remaining.isNotEmpty) {
    sections.add(BriefSection(
      briefSectionOther,
      [for (final e in remaining.entries) BriefField(e.key, e.value)],
    ));
  }
  return sections;
}

/// Which keys belong to which section, in reading order.
const _briefSectionKeys = <String, List<String>>{
  briefSectionChannel: [
    'channel_name',
    'channel_handle',
    'contact_name',
    'country',
    'channel_url',
    'channel_description',
  ],
  briefSectionAudience: ['subscriber_count', 'median_views'],
  briefSectionLatestUpload: [
    'last_video_title',
    'last_video_published_at',
    'last_video_views',
    'last_video_url',
    'last_video_description',
  ],
  briefSectionRecentUploads: ['recent_video_titles'],
  briefSectionFit: ['relevance_criteria', 'notes'],
  briefSectionDraft: [
    'sender_name',
    'writing_rules',
    'template_name',
    'template_subject',
    'template_body',
  ],
};

const briefSectionChannel = 'channel';
const briefSectionAudience = 'audience';
const briefSectionLatestUpload = 'latest_upload';
const briefSectionRecentUploads = 'recent_uploads';
const briefSectionFit = 'fit';
const briefSectionDraft = 'draft';
const briefSectionOther = 'other';

/// One group of related facts from the brief.
class BriefSection {
  const BriefSection(this.id, this.fields);

  /// One of the `briefSection*` constants — the view maps it to a heading.
  final String id;
  final List<BriefField> fields;
}

/// One fact: the key it has in the JSON payload, and its value.
///
/// Keeping the JSON key rather than a rendered label is deliberate — it is
/// what the model is told to quote the field by, so the reader is looking at
/// the same names the draft was written against.
class BriefField {
  const BriefField(this.key, this.value);

  final String key;
  final Object? value;
}

/// What the model is being asked to do, ahead of the data.
///
/// Deliberately English regardless of the app's locale: this text is not read
/// by the user, it is read by a model, and the drafts it produces go to
/// English-speaking creators. The button that copies it is localized; the
/// payload is not.
///
/// It asks for two things rather than one. The email was always the point, but
/// a draft arriving with no reasoning attached leaves the person holding it
/// with no way to judge it except taste — so the model first has to say what
/// it thinks this creator wants, what is weak about the channel, what would
/// get the email deleted, and what fact is missing. That read is what makes
/// the draft editable: it is the difference between "rewrite this, it feels
/// off" and "that hook is wrong, use the launch instead". The inferences are
/// fenced into PART 1 and forbidden from PART 2, so nothing guessed can walk
/// into the email itself.
///
/// The instructions do not restate the drafting doctrine. That doctrine is now
/// the course-built `gratovo-comms` Gemini skill (it replaced the old ~1300-line
/// drafter skill file, decision old-files), loaded alongside this brief in
/// whatever window does the drafting, and a compressed copy here
/// would only drift from it and contradict it — an earlier version of this
/// string capped the email at 150 words while the doctrine caps the initial
/// email at 70. So the brief points at that document for voice, the offer, the
/// hook, word count, the CTA and the subject line, and spells out only what the
/// doctrine does not cover: the PART 1 read, the initial-email-only scope, and
/// how to treat the JSON. It also says to stop when no doctrine is loaded,
/// rather than improvise one. This mirrors the Python path, which likewise
/// hands over only the JSON and leans on the loaded skill.
///
/// Contains no `{` on purpose: the brief is instructions followed by JSON, and
/// the first brace in the string is what marks where the payload starts.
const outreachBriefInstructions = '''
You are drafting a cold outreach email from an influencer-marketing agency to
the YouTube creator described in the JSON below.

You are working from the cold email drafter doctrine loaded alongside this
brief. That document is the authority on how the email reads: the voice, the
offer and the rule that there are no brands to name, personalization, the hook,
word count, the CTA, the subject line, the banned words. Follow it. This brief
does not restate those rules and does not override them. Where this brief is
silent, the doctrine governs; where the two appear to conflict, the doctrine
wins.

If that doctrine is not available to you, do not draft from this brief on its
own. Say so and stop.

This brief adds three things the doctrine does not cover.

FIRST, the output has two parts, in this order, separated by a line of three
dashes.

PART 1 - READ (for me, not for the creator; at most six short bullets):
  - Goal: what this creator is most plausibly working toward right now - growth,
    money, legitimacy, a launch - and what in the data says so.
  - Hook: the single detail worth opening on, and why it beats the other
    candidates in this data. Choose it by the doctrine's rules for the hook.
  - Weak point: the gap our offer speaks to, with the evidence for it - views
    uneven against subscriber count, a thin or absent description, a long
    silence since the last upload, no sign of a sponsor.
  - Leverage: what a place on the roster gives a creator at this size that they
    would actually want.
  - Landmine: the line most likely to get this email deleted - a claim their
    numbers do not support, a metric they would dispute, a register their
    content does not match.
  - Missing: the one fact worth checking before this is sent, and how it would
    change the email.
  Mark anything you worked out rather than read with "(inferred)". Where the
  data does not support a bullet, write "not enough data" - a guessed bullet is
  worse than a missing one. If more than half of these bullets are inferred,
  say so: it means the data is too thin to read.
  Nothing in PART 1 may appear in PART 2. The read is for judging the draft,
  not a source of facts for it.

SECOND, draft the initial email only. The follow-up sequence is a later pass.
Produce PART 2 as:
  - One subject line, on the first line, prefixed "Subject: ", derived by the
    doctrine's rules for subject lines.
  - Then a blank line, then the body.
  - Nothing else - no notes, no alternatives, no follow-up emails.

THIRD, the JSON is the only source of fact for the email.
  - A field that is absent is a thing you do not know: do not mention it and do
    not fill it in. Inferences stay in PART 1.
  - Quote any metric under the name the JSON gives it: `median_views` is a
    median, not an average, and calling it an average misstates it.
  - `roster_niche` may be absent. The doctrine says to infer the niche from the
    research; name the field you inferred it from, in PART 1.
  - Follow every entry in `writing_rules` if that field is present.
  - If `template` is present, adapt it - match its shape and intent, do not
    repeat it verbatim.
''';
