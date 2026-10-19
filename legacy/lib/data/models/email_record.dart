import 'package:gratovo_toolbox/core/sync/local_id.dart';
// Imported for the tag-vocabulary types the id lists below point into, so
// those references resolve rather than being prose.
import 'package:gratovo_toolbox/data/models/email_tag.dart';

/// How the library list is ordered inside a tab.
///
/// A view preference, not a filter: it is kept when you switch tabs, because
/// "show me the newest videos" means the same thing in both corpora. Every
/// option is most-recent-first — a study session works from the front of the
/// list.
enum EmailRecordSort {
  /// The *training video* was published most recently — advice from last month
  /// above advice from 2019. Records with no date sort to the end.
  videoDate,

  /// The row was saved most recently. The default: while a library is being
  /// filled in, "what was I just working on" is what the list should answer.
  lastEdited,

  /// The row was first captured most recently. Diverges from [lastEdited] only
  /// once old records start being revised.
  lastCreated;
}

/// Who an email in the library was written to.
///
/// The two tabs on the page, and the one axis the library never mixes:
/// a critique of a creator-outreach email says almost nothing useful about a
/// brand pitch, and a corpus that blends them teaches the wrong lesson to
/// whatever reads it next.
enum EmailAudience {
  influencer('influencer'),
  brand('brand');

  const EmailAudience(this.storageValue);

  /// See [EmailTagKind.storageValue] — same reasoning, same guarantee:
  /// the stored string must not move when a Dart identifier does.
  final String storageValue;

  static EmailAudience fromStorage(String value) => EmailAudience.values
      .firstWhere((a) => a.storageValue == value, orElse: () => influencer);
}

/// Where a record came from. Stored as [storageValue], which
/// `pipeline/tools/email_library.py --verdicts` reads too, so it must not
/// move when a Dart identifier does.
enum EmailRecordSource {
  /// Typed in from a training video: the library's original kind.
  video('video'),

  /// A skill factory bench draft, imported from
  /// `data/gemini skills/outreach/bench/latest.json`.
  testDraft('test-draft'),

  /// A real draft rated in the old "Draft with Gemini" dialog. The dialog is
  /// gone (the Comms queue drafts now); the value stays so records saved
  /// from it still load.
  appDraft('app-draft'),

  /// One of the owner's own emails, kept as an example (decision G3).
  mine('mine');

  const EmailRecordSource(this.storageValue);

  final String storageValue;

  /// A draft the factory wrote or helped write: the kind that takes a
  /// [EmailVerdict].
  bool get isDraft => this == testDraft || this == appDraft;

  static EmailRecordSource fromStorage(String? value) =>
      EmailRecordSource.values
          .firstWhere((s) => s.storageValue == value, orElse: () => video);
}

/// The owner's verdict on a draft. Good drafts become the skill factory's
/// goldens (later card versions must still pass them); bad ones, with the
/// owner's why, become its regression cases.
enum EmailVerdict {
  good('good'),
  bad('bad');

  const EmailVerdict(this.storageValue);

  final String storageValue;

  static EmailVerdict? fromStorage(String? value) {
    for (final verdict in values) {
      if (verdict.storageValue == value) return verdict;
    }
    return null;
  }
}

/// One email, with the expert critique of it.
///
/// This is a study corpus, not an outbox. Nothing here is ever sent: each row
/// is an email somebody wrote (usually in a training video), what was said
/// about it, and enough provenance to find the moment again. The critique is
/// the point — an email on its own is an example, an email with an expert
/// verdict on it is a lesson.
///
/// Every text field defaults to empty rather than null. A half-filled record
/// captured while a video is playing is worth more than a complete one that
/// was never typed, so nothing but the id is actually required, and "not
/// filled in" and "filled in as blank" are deliberately the same state.
class EmailRecord {
  const EmailRecord({
    required this.id,
    required this.audience,
    this.videoDate,
    this.videoUrl = '',
    this.timecodeSeconds,
    this.stageTagIds = const [],
    this.nicheTagIds = const [],
    this.context = '',
    this.subject = '',
    this.body = '',
    this.critique = '',
    required this.createdAt,
    required this.updatedAt,
    this.lastCopiedAt,
    this.source = EmailRecordSource.video,
    this.sourceRef,
    this.knobs = const {},
    this.facts = const {},
    this.verdict,
    this.verdictNote = '',
    this.verdictAt,
  });

  /// A new, empty record for [audience], pre-filled from [defaults].
  ///
  /// The date and URL carry over from the last record because a study session
  /// is one video: re-typing the same two fields twenty times is exactly the
  /// friction that stops a library like this from getting filled in. The stage
  /// tag carries for the same reason — a run of emails lifted from one video is
  /// nearly always the same point in the sequence.
  factory EmailRecord.blank({
    required EmailAudience audience,
    EmailDraftDefaults? defaults,
    DateTime? now,
  }) {
    final at = now ?? DateTime.now().toUtc();
    return EmailRecord(
      id: localUuid(),
      audience: audience,
      videoDate: defaults?.videoDate,
      videoUrl: defaults?.videoUrl ?? '',
      timecodeSeconds: defaults?.timecodeSeconds,
      stageTagIds: defaults?.stageTagIds ?? const [],
      createdAt: at,
      updatedAt: at,
    );
  }

  final String id;
  final EmailAudience audience;

  /// The day the *training video* was published — not the day this row was
  /// typed, which is [createdAt]. Advice from 2019 and advice from last month
  /// are not equally load-bearing, and this is the field that says which is
  /// which.
  ///
  /// A date with no time and no zone: a video's publication day is the same
  /// day everywhere, and running it through the app's timezone machinery would
  /// let it render as the day before in a western zone.
  final DateTime? videoDate;

  final String videoUrl;

  /// Where in that video this email appears, in whole seconds from the start.
  /// See `core/utils/timecode.dart` — with a YouTube URL this becomes a link
  /// that opens at the right moment, which is the difference between citing a
  /// source and re-watching an hour to find it again.
  final int? timecodeSeconds;

  /// Ids into the [EmailTagKind.stage] vocabulary.
  final List<String> stageTagIds;

  /// Ids into the [EmailTagKind.niche] vocabulary.
  final List<String> nicheTagIds;

  /// The situation the email was written into — who the recipient was, what
  /// had happened before it. Without this a follow-up is unreadable, since
  /// half its meaning is in the message it follows.
  final String context;

  final String subject;
  final String body;

  /// What the expert said about it. The reason the row exists.
  final String critique;

  /// When this row was typed, in UTC. Distinct from [videoDate] — see there.
  final DateTime createdAt;
  final DateTime updatedAt;

  /// When this record was last copied out for a handbook build, in UTC, or
  /// null when it never has been.
  ///
  /// Read-only as far as the editor is concerned: [copyWith] cannot change it
  /// and `saveRecord` does not write it, so editing an email can never rewrite
  /// its own copy history. `EmailLibraryRepository.markRecordsCopied` is the
  /// only thing that moves it. See that method for why the library tracks this
  /// at all.
  final DateTime? lastCopiedAt;

  final EmailRecordSource source;

  /// What [source] calls this email: a bench draft's id in
  /// `bench/latest.json` (`<runAt>/<draftId>`), which is what keeps a second
  /// import of the same run from adding it twice. Null for the other kinds.
  final String? sourceRef;

  /// The outreach knobs a draft was written under, by knob id. The factory
  /// drafts a bad one's situation again from these.
  final Map<String, String> knobs;

  /// The facts a draft was written from — the brief and the needs the cards
  /// asked for — as the factory's bench cases hold them.
  final Map<String, Object?> facts;

  /// The owner's verdict; only drafts ([EmailRecordSource.isDraft]) take one.
  final EmailVerdict? verdict;

  /// Why — required for a bad verdict, since a regression case without its
  /// reason cannot tell the judge what to look for.
  final String verdictNote;

  /// When the verdict was given, in UTC.
  final DateTime? verdictAt;

  /// A draft nobody has rated yet: marked in the list until it is.
  bool get isUnrated => source.isDraft && verdict == null;

  /// Nothing worth storing has been typed yet.
  ///
  /// Used to decide whether closing the editor needs a confirmation, and to
  /// stop "save and add another" from leaving an empty row behind. The date,
  /// URL, stage tag and timecode are excluded deliberately: they arrive
  /// pre-filled from [EmailDraftDefaults], so counting them would make every
  /// blank record look like it had content.
  bool get isEmpty =>
      subject.trim().isEmpty &&
      body.trim().isEmpty &&
      critique.trim().isEmpty &&
      context.trim().isEmpty &&
      nicheTagIds.isEmpty;

  EmailRecord copyWith({
    EmailAudience? audience,
    DateTime? videoDate,
    bool clearVideoDate = false,
    String? videoUrl,
    int? timecodeSeconds,
    bool clearTimecode = false,
    List<String>? stageTagIds,
    List<String>? nicheTagIds,
    String? context,
    String? subject,
    String? body,
    String? critique,
    DateTime? updatedAt,
    EmailRecordSource? source,
    EmailVerdict? verdict,
    bool clearVerdict = false,
    String? verdictNote,
    DateTime? verdictAt,
  }) {
    return EmailRecord(
      id: id,
      audience: audience ?? this.audience,
      videoDate: clearVideoDate ? null : (videoDate ?? this.videoDate),
      videoUrl: videoUrl ?? this.videoUrl,
      timecodeSeconds:
          clearTimecode ? null : (timecodeSeconds ?? this.timecodeSeconds),
      stageTagIds: stageTagIds ?? this.stageTagIds,
      nicheTagIds: nicheTagIds ?? this.nicheTagIds,
      context: context ?? this.context,
      subject: subject ?? this.subject,
      body: body ?? this.body,
      critique: critique ?? this.critique,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      // Carried, never set: an edit preserves the copy history it found, and
      // has no way to invent one. See [lastCopiedAt].
      lastCopiedAt: lastCopiedAt,
      source: source ?? this.source,
      // What a draft was written under is history too: carried, never edited.
      sourceRef: sourceRef,
      knobs: knobs,
      facts: facts,
      verdict: clearVerdict ? null : (verdict ?? this.verdict),
      verdictNote: verdictNote ?? this.verdictNote,
      verdictAt: clearVerdict ? null : (verdictAt ?? this.verdictAt),
    );
  }
}

/// The oldest and newest video date one tab actually holds.
///
/// The corpus's real span, and the only honest answer to "how wide can this
/// range be?". A copy range that reaches past the newest video date has
/// nothing at that end of it, so the dialog opens on this span and its wheels
/// stop at it: scrolling to the end of the range is scrolling to the end of
/// the corpus.
///
/// Records with no video date are not represented here — they are in no range
/// at all, so they cannot widen one. A tab where nothing carries a date has no
/// bounds rather than an invented pair.
class EmailVideoDateBounds {
  const EmailVideoDateBounds({required this.earliest, required this.latest});

  /// Both date-only and both inclusive — see [EmailRecord.videoDate] for why a
  /// publication day never becomes an instant.
  final DateTime earliest;
  final DateTime latest;

  @override
  bool operator ==(Object other) =>
      other is EmailVideoDateBounds &&
      other.earliest == earliest &&
      other.latest == latest;

  @override
  int get hashCode => Object.hash(earliest, latest);
}

/// What survives from one record to the next, per audience.
///
/// Per audience rather than global: the influencer tab and the brand tab are
/// usually two different training videos, and one shared default would have
/// each tab overwriting the other's every time you switched.
class EmailDraftDefaults {
  const EmailDraftDefaults({
    this.videoDate,
    this.videoUrl = '',
    this.timecodeSeconds,
    this.stageTagIds = const [],
  });

  final DateTime? videoDate;
  final String videoUrl;

  /// Where the last saved record sat in the video. A run of emails is read off
  /// one recording in one pass, so the next one is always a little further in
  /// than the last — starting from there is a nudge on the seconds rather than
  /// entering the whole position again.
  final int? timecodeSeconds;

  /// The stage tag(s) the last saved record carried. A run of emails lifted
  /// from one video is nearly always the same point in the sequence, so
  /// re-picking the stage every time is most of the friction. Niche tags are
  /// left out on purpose: those change from email to email in a way the stage
  /// does not.
  final List<String> stageTagIds;

  bool get isEmpty =>
      videoDate == null &&
      videoUrl.trim().isEmpty &&
      timecodeSeconds == null &&
      stageTagIds.isEmpty;

  EmailDraftDefaults copyWith({
    DateTime? videoDate,
    bool clearVideoDate = false,
    String? videoUrl,
    int? timecodeSeconds,
    bool clearTimecode = false,
    List<String>? stageTagIds,
  }) {
    return EmailDraftDefaults(
      videoDate: clearVideoDate ? null : (videoDate ?? this.videoDate),
      videoUrl: videoUrl ?? this.videoUrl,
      timecodeSeconds:
          clearTimecode ? null : (timecodeSeconds ?? this.timecodeSeconds),
      stageTagIds: stageTagIds ?? this.stageTagIds,
    );
  }
}
