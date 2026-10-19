/// Turning a slice of the Email Critique Library into something an LLM can
/// build a handbook out of.
///
/// Pure string work, deliberately with no Flutter and no repository in it: the
/// payload is the part of this feature most worth pinning down in a test, and
/// the part most likely to be read by somebody wondering why a handbook came
/// out the shape it did. Both are easier when it is one function you can call
/// with a list of records.
///
/// The output is one Markdown document: a self-contained brief at the top,
/// then the records verbatim. Self-contained is the requirement that shapes
/// everything here - it gets pasted into a fresh chat that has never seen this
/// project, cannot open `pipeline/tools/outreach playbook.md`, and has no idea
/// what a "niche tag" is. Anything the brief does not say is not known.
library;

import 'package:gratovo_toolbox/core/utils/timecode.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/sqlite_email_library_repository.dart'
    show formatDateOnly;

/// The whole clipboard payload: the brief, the batch's provenance, then every
/// record in [records].
///
/// [tagLabels] resolves tag ids to their labels - ids are meaningless to a
/// reader, so a record whose tag is missing from the map simply omits it
/// rather than emitting a raw uuid.
///
/// [from] and [to] are the video-date range the batch was taken from, and
/// [generatedAt] is the moment of the copy. Both are stated in the output so a
/// handbook built from this can say what it was built from.
String buildHandbookExport({
  required List<EmailRecord> records,
  required Map<String, EmailTag> tagLabels,
  required EmailAudience audience,
  required DateTime from,
  required DateTime to,
  required DateTime generatedAt,
}) {
  final buffer = StringBuffer()
    ..writeln(_brief(audience))
    ..writeln()
    ..writeln('---')
    ..writeln()
    ..writeln('## Batch provenance')
    ..writeln()
    ..writeln('- Audience: ${_audienceName(audience)}')
    ..writeln(
      '- Video-date range: ${formatDateOnly(from)} to ${formatDateOnly(to)} '
      '(inclusive)',
    )
    ..writeln('- Records in this batch: ${records.length}')
    ..writeln('- Exported: ${formatDateOnly(generatedAt)}')
    ..writeln()
    ..writeln('---')
    ..writeln()
    ..writeln('## Source records');

  for (var i = 0; i < records.length; i++) {
    buffer
      ..writeln()
      ..write(_recordSection(records[i], i + 1, tagLabels));
  }

  return buffer.toString();
}

/// How many words are in a critique.
///
/// Whitespace-separated runs, which is as exact as this needs to be: the
/// number exists so somebody scanning the copy dialog can tell a one-line
/// aside from a real teardown before shipping forty records to a model. A
/// record with a two-word critique is usually one that was never finished.
int critiqueWordCount(String critique) {
  final trimmed = critique.trim();
  if (trimmed.isEmpty) return 0;
  return trimmed.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
}

/// "Never copied", "Copied today", "Copied 9 days ago".
///
/// Coarse on purpose, and coarser the further back it goes. The question this
/// answers is "have I already fed this to a handbook build, and was it recent
/// enough to matter?" - and for that, "3 months ago" and "97 days ago" are the
/// same answer, while the exact hour is never the answer.
///
/// [now] defaults to the current instant; it is a parameter so this is
/// testable without a clock.
String copyRecencyLabel(DateTime? lastCopiedAt, {DateTime? now}) {
  if (lastCopiedAt == null) return 'Never copied';

  final at = lastCopiedAt.toUtc();
  final current = (now ?? DateTime.now()).toUtc();

  // Whole days between the two calendar days, not between the two instants:
  // something copied at 23:00 yesterday is "yesterday", not "9 hours ago".
  final days = DateTime.utc(current.year, current.month, current.day)
      .difference(DateTime.utc(at.year, at.month, at.day))
      .inDays;

  // A clock that moved backwards, or a row stamped by another machine running
  // ahead. Not worth a branch of its own - it was copied, and it was recent.
  if (days <= 0) return 'Copied today';
  if (days == 1) return 'Copied yesterday';
  if (days < 30) return 'Copied $days days ago';
  if (days < 365) {
    final months = days ~/ 30;
    return months == 1 ? 'Copied 1 month ago' : 'Copied $months months ago';
  }
  final years = days ~/ 365;
  return years == 1 ? 'Copied 1 year ago' : 'Copied $years years ago';
}

/// Every tag on [record] that [tagLabels] can name, stage tags first.
///
/// Stage first because it is the one axis that orders the sequence - where an
/// email sits in the outreach run is the first thing you want to see, and the
/// niches are detail after it.
List<EmailTag> resolveRecordTags(
  EmailRecord record,
  Map<String, EmailTag> tagLabels,
) {
  return [
    for (final id in [...record.stageTagIds, ...record.nicheTagIds])
      if (tagLabels[id] != null) tagLabels[id]!,
  ];
}

String _audienceName(EmailAudience audience) => switch (audience) {
      EmailAudience.influencer => 'Influencers / creators (B2C outreach)',
      EmailAudience.brand => 'Brands / companies (B2B outreach)',
    };

/// The instruction block at the top of the payload.
///
/// Written as a brief to a reader with no context whatsoever, because that is
/// exactly what it gets. Every term the records use - critique, context,
/// timecode, stage, niche - is defined here, and the target document's shape
/// is described rather than referenced, since the model on the other end
/// cannot open the file it is being asked to resemble.
String _brief(EmailAudience audience) {
  final audienceLine = switch (audience) {
    EmailAudience.influencer =>
      'Every email in this batch was written to an **influencer or content '
          'creator** - B2C-style outreach, usually proposing a sponsorship, a '
          'collaboration, or a paid placement.',
    EmailAudience.brand =>
      'Every email in this batch was written to a **brand or company** - '
          'B2B-style outreach, usually pitching a service, a partnership, or '
          'representation.',
  };

  return '''
# Build an outreach handbook from these critiques

You are being handed a batch of raw study notes on cold-outreach emails. Turn
them into one self-contained Markdown handbook. Everything you need is in this
message - do not ask for files, and do not assume you can open anything.

## What this data is

Below is a numbered list of records. Each record is **one real cold email**,
quoted verbatim, paired with **the verdict an expert gave on it** while
reviewing it out loud in a training video.

$audienceLine

Each record can carry these fields:

- **Video date** - when the training video was published. Advice from three
  years ago and advice from last month are not equally load-bearing; where two
  records disagree, the newer one is usually the revision.
- **Timecode** - where in that video the email was reviewed.
- **Stage** - where the email sits in an outreach sequence: initial cold
  outreach, follow-up, or closing.
- **Niche** - what industry or vertical the email was for.
- **Context** - the situation the email was written into: who the recipient
  was, what had already happened. A follow-up is unreadable without it.
- **Subject** and **Body** - the email itself, exactly as written. `@receiver`,
  `@sender`, `@creator`, `@brand` and `@product` are placeholders standing in
  for real names.
- **Critique** - what the expert said about it.

**The critique is the load-bearing part.** The email is the example; the
critique is the lesson. An email with no critique is a data point with no
verdict attached - use it only as illustration, never as the source of a rule.

## What to produce

A single Markdown document, structured like this:

1. An `# H1` title.
2. A short provenance paragraph: what this was built from, the date range, and
   how many source records.
3. A **Contents** list, numbered, linking to each section anchor.
4. Then numbered `## H2` sections. Suggested spine - drop any section the data
   does not support, and add any it demands:
   - Core Principles
   - Power Dynamics (who is asking whom for what)
   - Anatomy of a Cold Email (subject line, opener, body, offer, CTA, sign-off)
   - Personalisation & Research
   - Follow-Up Sequences
   - Handling Replies & Objections
   - Negotiation & Pricing
   - Banned Words & Phrases
   - Hard "Never Do" List
   - Worked Examples (a weak email, the critique, and the rewrite)
   - Pre-Send Checklist
5. Inside each section, state rules in a Markdown table with the columns
   `| # | Rule | Why |`, numbered `<section>.<n>` - so 3.1, 3.2, and so on.
   The **Why** column carries the expert's actual reasoning, not your own.

## Rules for the extraction

1. **Be exhaustive.** Extract every rule, heuristic, warning and preference
   the critiques contain, including ones stated only once and ones stated in
   passing. A rule you judged too minor to include is the failure mode here.
2. **Deduplicate ruthlessly.** The same advice recurs across many records.
   State it once, in the section where it belongs, and let its frequency show
   up as confidence - a rule repeated in ten records is a stronger rule than
   one mentioned once, and it is worth saying so.
3. **Preserve exact wording for examples.** When a critique names a phrase as
   good or bad, quote that phrase verbatim rather than paraphrasing it. The
   before/after pairs are most of the practical value; a paraphrase destroys
   them. Prefer a two-column `Instead of | Write` table for these.
4. **Never invent.** Every rule must trace to a critique in this batch. Do not
   supplement from general knowledge about cold email, and do not smooth over a
   gap with something that sounds right. If the data does not cover something,
   the handbook does not cover it.
5. **Surface contradictions, do not resolve them silently.** When two records
   disagree, give the disagreement its own section near the end: what each
   said, which record each came from, which is more recent, and your reading of
   which applies when. A handbook that hides a conflict teaches a rule that
   will fail.
6. **Cite provenance.** After each rule, note the record number(s) it came
   from, like `[#4, #17]`, so any line can be traced back to the email that
   produced it.
7. **Generalise, but only one step.** A critique about one email's specific
   wording becomes a rule about that kind of wording. It does not become a rule
   about outreach in general.
8. **Keep the reader in mind.** This is a working reference someone consults
   mid-draft, not an essay. Short rules, scannable tables, no throat-clearing.

Output the finished Markdown document and nothing else - no preamble, no
summary of what you did.''';
}

/// One record, as a Markdown subsection.
///
/// Missing fields are omitted rather than written as "(none)": a brief that
/// says "each record *can* carry these fields" and then shows twelve empty
/// slots per record is mostly noise, and noise is what a model reading forty
/// of these has least room for.
String _recordSection(
  EmailRecord record,
  int number,
  Map<String, EmailTag> tagLabels,
) {
  final tags = resolveRecordTags(record, tagLabels);
  final stages = [
    for (final tag in tags)
      if (tag.kind == EmailTagKind.stage) tag.label,
  ];
  final niches = [
    for (final tag in tags)
      if (tag.kind == EmailTagKind.niche) tag.label,
  ];

  final buffer = StringBuffer()..writeln('### Record #$number');

  final meta = <String>[
    if (record.videoDate != null)
      '- Video date: ${formatDateOnly(record.videoDate)}',
    if (formatTimecode(record.timecodeSeconds) != null)
      '- Timecode: ${formatTimecode(record.timecodeSeconds)}',
    if (stages.isNotEmpty) '- Stage: ${stages.join(', ')}',
    if (niches.isNotEmpty) '- Niche: ${niches.join(', ')}',
    if (record.videoUrl.trim().isNotEmpty)
      '- Source: ${record.videoUrl.trim()}',
  ];
  if (meta.isNotEmpty) {
    buffer
      ..writeln()
      ..writeln(meta.join('\n'));
  }

  _writeBlock(buffer, 'Context', record.context);
  _writeBlock(buffer, 'Subject', record.subject);
  _writeBlock(buffer, 'Body', record.body);
  _writeBlock(buffer, 'Critique', record.critique);

  return buffer.toString();
}

/// A labelled, fenced block - or nothing at all when [value] is blank.
///
/// Fenced rather than indented or inline because an email body is multi-line
/// free text that regularly contains `-`, `#` and `>` at the start of a line.
/// Unfenced, those would read as Markdown structure belonging to the document
/// rather than as characters the sender typed.
void _writeBlock(StringBuffer buffer, String label, String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return;
  final fence = _fenceFor(trimmed);
  buffer
    ..writeln()
    ..writeln('**$label:**')
    ..writeln()
    ..writeln(fence)
    ..writeln(trimmed)
    ..writeln(fence);
}

/// A backtick fence long enough that [content] cannot close it early.
///
/// Three backticks unless the text itself contains a run of three or more, in
/// which case one longer than the longest run - the rule CommonMark uses. An
/// email quoting a code block is rare, but a batch that silently mangles every
/// record after the one that did it would be very hard to spot from the
/// handbook that came out.
String _fenceFor(String content) {
  var longest = 0;
  var run = 0;
  for (final unit in content.codeUnits) {
    if (unit == 0x60) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return '`' * (longest < 3 ? 3 : longest + 1);
}
