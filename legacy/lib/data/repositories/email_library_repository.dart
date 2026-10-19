import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';

/// How the Email Critique Library reads and writes its corpus.
///
/// **Local only, on purpose.** Every other repository in this folder has a
/// Supabase implementation because the data behind it is the team's. This one
/// does not: it is one person's study notes on other people's emails, it is
/// worthless until there is a lot of it, and half-formed notes syncing to
/// eight machines the moment they are typed is a cost with no matching
/// benefit. The file it writes lives beside the pipeline's own `gratovo.db`
/// (see `email_library_providers.dart` for why there rather than in the app's
/// support folder), which is what lets `pipeline/tools/email_library.py` read
/// the corpus back out to improve the drafting skills.
///
/// If it ever should be shared, this interface is the seam: add a
/// `SupabaseEmailLibraryRepository` and switch the provider. No screen
/// changes.
abstract class EmailLibraryRepository {
  /// Whether there is somewhere to write at all.
  ///
  /// False on web and on a machine whose database could not be opened. The
  /// page shows an explanation instead of an editor rather than accepting
  /// records into memory that vanish on close — a study corpus you cannot
  /// trust to still be there tomorrow is worse than none.
  bool get isAvailable;

  /// Records for one tab, ordered by [sort] (each option most-recent-first).
  ///
  /// [search] matches subject, body, context and critique, case-insensitively.
  /// [stageTagIds] and [nicheTagIds] narrow to records carrying **all** of the
  /// given tags — the useful question is "cold opens in fitness", not "cold
  /// opens or fitness". [source], when given, keeps only that kind of record
  /// ("Test drafts").
  Future<List<EmailRecord>> listRecords({
    required EmailAudience audience,
    String? search,
    List<String> stageTagIds = const [],
    List<String> nicheTagIds = const [],
    EmailRecordSort sort = EmailRecordSort.lastEdited,
    EmailRecordSource? source,
  });

  /// Every record in [audience] whose **video date** falls within [from] and
  /// [to] inclusive, oldest first.
  ///
  /// Video date rather than [EmailRecord.createdAt] because this feeds the
  /// handbook export, and the question it answers is "everything I studied
  /// from that run of videos" - a property of the source material, not of when
  /// somebody happened to type the row. Records with no video date are
  /// therefore not in any range and never come back from here; the copy dialog
  /// says so rather than letting them vanish silently.
  ///
  /// Oldest first, unlike every other list in this repository. The list on
  /// screen is for finding one lesson again, so it leads with the newest; this
  /// is a corpus being handed to a reader that starts at the top, and advice
  /// reads correctly in the order it was given.
  Future<List<EmailRecord>> listRecordsInVideoDateRange({
    required EmailAudience audience,
    required DateTime from,
    required DateTime to,
  });

  /// The oldest and newest video date in [audience], or null when nothing in
  /// that tab carries one.
  ///
  /// What the copy dialog opens its range on and how far its wheels turn. Read
  /// as two aggregates rather than by loading the tab and taking the ends: the
  /// question is one row wide, and the answer is wanted before any record is.
  Future<EmailVideoDateBounds?> videoDateBounds(EmailAudience audience);

  Future<EmailRecord?> getRecord(String id);

  /// Inserts or replaces, tags included, in one transaction.
  Future<void> saveRecord(EmailRecord record);

  Future<void> deleteRecord(String id);

  /// Adds each of [records] whose [EmailRecord.sourceRef] is not in the
  /// library yet, tags included, and returns how many that was.
  ///
  /// For imports (a bench run): the same run read twice adds nothing, and a
  /// draft already rated keeps its verdict rather than being overwritten by
  /// the unrated copy in the file. A record with no `sourceRef` is always
  /// added.
  Future<int> importRecords(List<EmailRecord> records);

  /// Stamps [at] on every record in [ids] as its new
  /// [EmailRecord.lastCopiedAt].
  ///
  /// The only writer of that column - see [EmailRecord.lastCopiedAt] for why
  /// `saveRecord` deliberately leaves it alone. Called after a successful
  /// clipboard write, not before it: a copy that failed did not happen, and
  /// recording it would make the library lie about what has already been fed
  /// to a handbook build.
  ///
  /// Ids that are not in the library are ignored rather than being an error.
  Future<void> markRecordsCopied(List<String> ids, DateTime at);

  /// How many records each tab holds — for the tab labels, without loading
  /// either list.
  Future<Map<EmailAudience, int>> countRecords();

  /// One vocabulary, in [compareEmailTags] order.
  Future<List<EmailTag>> listTags(EmailTagKind kind);

  /// Adds [label] to [kind], or returns the existing tag when it is already
  /// there under any casing.
  ///
  /// Returning the existing one rather than failing is what makes the "+"
  /// button safe to press without checking first: the outcome either way is
  /// "this tag now exists and is the one you meant".
  Future<EmailTag> addTag({required EmailTagKind kind, required String label});

  Future<void> renameTag(String id, String label);

  /// Removes a tag from the vocabulary and from every record carrying it.
  Future<void> deleteTag(String id);

  /// How many records carry each tag id, for the whole library.
  ///
  /// Two jobs: showing which niches the corpus actually covers, and warning
  /// before a delete that would strip a tag off thirty records.
  Future<Map<String, int>> tagUsageCounts(EmailTagKind kind);

  /// The date and URL a new record in [audience] starts with.
  Future<EmailDraftDefaults> readDefaults(EmailAudience audience);

  /// Remembers them for the next new record. Called on save, not on keystroke.
  Future<void> writeDefaults(EmailAudience audience, EmailDraftDefaults value);
}
