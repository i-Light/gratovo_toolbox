import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/outreach_file_store.dart';
import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/data/repositories/email_library/email_library_providers.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library/skills_library_providers.dart';
import 'package:gratovo_toolbox/features/email_library/application/bench_draft_import.dart';

/// What the Email Critique Library page is currently looking at.
///
/// One notifier for the whole page rather than one per control, because the
/// three pieces are not independent: switching tab has to clear the tag
/// filters (a stage tag means something in both tabs, a niche filter usually
/// does not), and every one of them re-runs the same query.

/// Which tab is open. Persisted nowhere on purpose — a session starts on
/// influencers because that is the bulk of the corpus.
final emailAudienceProvider =
    NotifierProvider<EmailAudienceNotifier, EmailAudience>(
  EmailAudienceNotifier.new,
);

class EmailAudienceNotifier extends Notifier<EmailAudience> {
  @override
  EmailAudience build() => EmailAudience.influencer;

  void select(EmailAudience audience) {
    if (state == audience) return;
    state = audience;
    // Filters belong to the tab you set them on. Carrying "fitness" across to
    // the brands tab would show an empty list and look like data loss.
    ref.read(emailLibraryFilterProvider.notifier).clear();
  }
}

/// How the list is ordered inside the open tab.
///
/// Its own notifier, separate from the filter: a filter belongs to the tab you
/// set it on and is cleared on a tab switch, but a sort is a view preference
/// that means the same thing in both corpora and is kept.
final emailRecordSortProvider =
    NotifierProvider<EmailRecordSortNotifier, EmailRecordSort>(
  EmailRecordSortNotifier.new,
);

class EmailRecordSortNotifier extends Notifier<EmailRecordSort> {
  @override
  EmailRecordSort build() => EmailRecordSort.videoDate;

  void select(EmailRecordSort sort) => state = sort;
}

/// How the list is narrowed inside the open tab.
class EmailLibraryFilter {
  const EmailLibraryFilter({
    this.search = '',
    this.stageTagIds = const <String>{},
    this.nicheTagIds = const <String>{},
    this.source,
  });

  final String search;
  final Set<String> stageTagIds;
  final Set<String> nicheTagIds;

  /// One kind of record only ("Test drafts"), or every kind when null.
  final EmailRecordSource? source;

  bool get isUnfiltered =>
      search.trim().isEmpty &&
      stageTagIds.isEmpty &&
      nicheTagIds.isEmpty &&
      source == null;

  int get activeCount =>
      stageTagIds.length +
      nicheTagIds.length +
      (search.trim().isEmpty ? 0 : 1) +
      (source == null ? 0 : 1);

  EmailLibraryFilter copyWith({
    String? search,
    Set<String>? stageTagIds,
    Set<String>? nicheTagIds,
    EmailRecordSource? source,
    bool clearSource = false,
  }) {
    return EmailLibraryFilter(
      search: search ?? this.search,
      stageTagIds: stageTagIds ?? this.stageTagIds,
      nicheTagIds: nicheTagIds ?? this.nicheTagIds,
      source: clearSource ? null : (source ?? this.source),
    );
  }

  @override
  bool operator ==(Object other) =>
      other is EmailLibraryFilter &&
      other.search == search &&
      other.source == source &&
      other.stageTagIds.length == stageTagIds.length &&
      other.stageTagIds.containsAll(stageTagIds) &&
      other.nicheTagIds.length == nicheTagIds.length &&
      other.nicheTagIds.containsAll(nicheTagIds);

  @override
  int get hashCode => Object.hash(
        search,
        Object.hashAllUnordered(stageTagIds),
        Object.hashAllUnordered(nicheTagIds),
        source,
      );
}

class EmailLibraryFilterNotifier extends Notifier<EmailLibraryFilter> {
  @override
  EmailLibraryFilter build() => const EmailLibraryFilter();

  void setSearch(String value) => state = state.copyWith(search: value);

  void toggleStageTag(String id) => state = state.copyWith(
        stageTagIds: _toggled(state.stageTagIds, id),
      );

  void toggleNicheTag(String id) => state = state.copyWith(
        nicheTagIds: _toggled(state.nicheTagIds, id),
      );

  /// Null shows every kind of record.
  void setSource(EmailRecordSource? source) => state = source == null
      ? state.copyWith(clearSource: true)
      : state.copyWith(source: source);

  void clear() => state = const EmailLibraryFilter();

  Set<String> _toggled(Set<String> current, String id) {
    final next = {...current};
    if (!next.remove(id)) next.add(id);
    return next;
  }
}

final emailLibraryFilterProvider =
    NotifierProvider<EmailLibraryFilterNotifier, EmailLibraryFilter>(
  EmailLibraryFilterNotifier.new,
);

/// The records the list shows: the open tab, narrowed by the open filter.
final emailRecordsProvider = FutureProvider<List<EmailRecord>>((ref) {
  final audience = ref.watch(emailAudienceProvider);
  final filter = ref.watch(emailLibraryFilterProvider);
  final sort = ref.watch(emailRecordSortProvider);
  return ref.watch(emailLibraryRepositoryProvider).listRecords(
        audience: audience,
        search: filter.search,
        stageTagIds: filter.stageTagIds.toList(),
        nicheTagIds: filter.nicheTagIds.toList(),
        sort: sort,
        source: filter.source,
      );
});

/// One tab's records over one span of video dates - what the handbook export
/// is about to copy.
///
/// A family key rather than a notifier holding the dates, because the range
/// lives entirely inside the copy dialog: it is not a view of the library the
/// rest of the page shares, and closing the dialog should forget it.
@immutable
class EmailVideoDateRange {
  const EmailVideoDateRange({
    required this.audience,
    required this.from,
    required this.to,
  });

  final EmailAudience audience;

  /// Both ends inclusive, and both date-only - see
  /// [EmailRecord.videoDate] for why a publication day never becomes an
  /// instant. Callers pass whole days; anything finer is ignored by the query.
  final DateTime from;
  final DateTime to;

  bool get isValid => !from.isAfter(to);

  @override
  bool operator ==(Object other) =>
      other is EmailVideoDateRange &&
      other.audience == audience &&
      other.from == from &&
      other.to == to;

  @override
  int get hashCode => Object.hash(audience, from, to);
}

/// The records a handbook export would take, for the range the dialog is
/// showing.
final emailRecordsInRangeProvider =
    FutureProvider.family<List<EmailRecord>, EmailVideoDateRange>(
  (ref, range) {
    if (!range.isValid) return Future.value(const <EmailRecord>[]);
    return ref
        .watch(emailLibraryRepositoryProvider)
        .listRecordsInVideoDateRange(
          audience: range.audience,
          from: range.from,
          to: range.to,
        );
  },
);

/// How far one tab's video dates run - the copy dialog's opening range, and
/// the stop its date wheels turn against.
///
/// Family-keyed on the audience because the two tabs are two different runs of
/// videos: the brands corpus starting in March says nothing about where the
/// influencer one starts. Null while a tab holds no dated record at all, which
/// the dialog reads as "no limit" rather than as an empty span.
final emailVideoDateBoundsProvider =
    FutureProvider.family<EmailVideoDateBounds?, EmailAudience>(
  (ref, audience) =>
      ref.watch(emailLibraryRepositoryProvider).videoDateBounds(audience),
);

/// Per-tab totals for the tab labels — ignores the filter deliberately, so the
/// number on a tab is how much is in it, not how much a filter left visible.
final emailRecordCountsProvider = FutureProvider<Map<EmailAudience, int>>(
  (ref) => ref.watch(emailLibraryRepositoryProvider).countRecords(),
);

/// One tag vocabulary, already in display order.
///
/// Family-keyed on the kind so both controls share one provider and one cache;
/// invalidating after an add refreshes every control showing that vocabulary
/// at once, including the filter row and whatever editor is open.
final emailTagsProvider =
    FutureProvider.family<List<EmailTag>, EmailTagKind>((ref, kind) async {
  final tags = await ref.watch(emailLibraryRepositoryProvider).listTags(kind);
  return [...tags]..sort(compareEmailTags);
});

/// How many records carry each tag, for the manage-tags sheet.
final emailTagUsageProvider =
    FutureProvider.family<Map<String, int>, EmailTagKind>(
  (ref, kind) => ref.watch(emailLibraryRepositoryProvider).tagUsageCounts(kind),
);

/// The date, URL and stage tag a new record in the open tab starts with.
final emailDraftDefaultsProvider =
    FutureProvider.family<EmailDraftDefaults, EmailAudience>(
  (ref, audience) =>
      ref.watch(emailLibraryRepositoryProvider).readDefaults(audience),
);

/// Everything the page can do to the library, in one place.
///
/// Screens call these instead of touching the repository, so that "what has to
/// be refreshed after this write" is decided once, here, rather than being
/// re-derived (and eventually got wrong) at each call site.
class EmailLibraryActions {
  const EmailLibraryActions(this._ref);

  final Ref _ref;

  /// Saves [record] and remembers its date, URL and stage tag as the next
  /// record's starting point.
  ///
  /// The defaults are written here rather than in the editor because they are
  /// a consequence of saving, not of typing: a URL half-pasted into an editor
  /// that is then cancelled should not become the default for everything
  /// after it.
  Future<void> saveRecord(EmailRecord record) async {
    final repository = _ref.read(emailLibraryRepositoryProvider);
    await repository.saveRecord(record);
    // A draft has no video: rating one in the editor must not blank the date
    // and URL the next record typed from a video starts with.
    if (record.source.isDraft) {
      _invalidateRecords(record.audience);
      return;
    }
    await repository.writeDefaults(
      record.audience,
      EmailDraftDefaults(
        videoDate: record.videoDate,
        videoUrl: record.videoUrl,
        timecodeSeconds: record.timecodeSeconds,
        stageTagIds: record.stageTagIds,
      ),
    );
    _invalidateRecords(record.audience);
  }

  /// Records that [records] have just been copied out for a handbook build.
  ///
  /// Called *after* the clipboard write succeeds, never before - see
  /// `EmailLibraryRepository.markRecordsCopied`. The list refreshes as well as
  /// the range, so a record's "copied today" is true on the card behind the
  /// dialog too.
  Future<void> markCopied(Iterable<EmailRecord> records) async {
    final ids = [for (final record in records) record.id];
    if (ids.isEmpty) return;
    await _ref
        .read(emailLibraryRepositoryProvider)
        .markRecordsCopied(ids, DateTime.now().toUtc());
    _ref.invalidate(emailRecordsProvider);
    // The whole family: a record can sit in more than one range the dialog has
    // looked at this session, and every one of them now shows a stale
    // "never copied".
    _ref.invalidate(emailRecordsInRangeProvider);
  }

  /// The skill factory's last bench run (`bench/latest.json` in the outreach
  /// folder) into the library as "test drafts". Drafts already imported are
  /// left alone, verdict and all, so this is safe to run every time the
  /// library opens. Returns how many were new; 0 when there is no folder, no
  /// run, or nothing new. A file that cannot be read is not an error here —
  /// the library is still usable without it — so it also reads as 0.
  Future<int> importBenchDrafts() async {
    final store = _ref.read(outreachFileStoreProvider);
    final repository = _ref.read(emailLibraryRepositoryProvider);
    if (store == null || !repository.isAvailable) return 0;
    final String? text;
    try {
      text = await store.read('bench/latest.json');
    } on OutreachFileException {
      return 0;
    }
    if (text == null) return 0;
    final added = await repository.importRecords(benchDraftRecords(text));
    if (added > 0) {
      for (final audience in EmailAudience.values) {
        _invalidateRecords(audience);
      }
    }
    return added;
  }

  /// Rates a draft. A [verdict] of null takes the rating off again.
  ///
  /// Saved straight away rather than through the editor: rating a run of ten
  /// drafts is ten taps, not ten dialogs. Not a "save" in the editor's sense
  /// either — it leaves the next new record's defaults alone.
  Future<void> setVerdict(
    EmailRecord record,
    EmailVerdict? verdict, {
    String note = '',
  }) async {
    final now = DateTime.now().toUtc();
    await _ref.read(emailLibraryRepositoryProvider).saveRecord(
          record.copyWith(
            verdict: verdict,
            clearVerdict: verdict == null,
            verdictNote: verdict == null ? '' : note.trim(),
            verdictAt: now,
            updatedAt: now,
          ),
        );
    _invalidateRecords(record.audience);
  }

  Future<void> deleteRecord(EmailRecord record) async {
    await _ref.read(emailLibraryRepositoryProvider).deleteRecord(record.id);
    _invalidateRecords(record.audience);
  }

  /// Adds [label] to [kind], or hands back the tag that already meant it.
  Future<EmailTag> addTag(EmailTagKind kind, String label) async {
    final tag = await _ref
        .read(emailLibraryRepositoryProvider)
        .addTag(kind: kind, label: label);
    _ref.invalidate(emailTagsProvider(kind));
    return tag;
  }

  Future<void> renameTag(EmailTag tag, String label) async {
    await _ref.read(emailLibraryRepositoryProvider).renameTag(tag.id, label);
    _ref.invalidate(emailTagsProvider(tag.kind));
  }

  Future<void> deleteTag(EmailTag tag) async {
    await _ref.read(emailLibraryRepositoryProvider).deleteTag(tag.id);
    _ref.invalidate(emailTagsProvider(tag.kind));
    _ref.invalidate(emailTagUsageProvider(tag.kind));
    // Records lose the tag by cascade, so the list is now stale too.
    _ref.invalidate(emailRecordsProvider);
  }

  void _invalidateRecords(EmailAudience audience) {
    _ref.invalidate(emailRecordsProvider);
    _ref.invalidate(emailRecordCountsProvider);
    // A saved or deleted video date can be the tab's oldest or newest, which
    // moves both where the copy dialog opens and where its wheels stop.
    _ref.invalidate(emailVideoDateBoundsProvider(audience));
    _ref.invalidate(emailDraftDefaultsProvider(audience));
    _ref.invalidate(emailTagUsageProvider(EmailTagKind.stage));
    _ref.invalidate(emailTagUsageProvider(EmailTagKind.niche));
  }
}

final emailLibraryActionsProvider =
    Provider<EmailLibraryActions>(EmailLibraryActions.new);
