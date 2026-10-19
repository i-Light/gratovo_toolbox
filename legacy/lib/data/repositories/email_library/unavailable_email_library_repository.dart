import 'package:gratovo_toolbox/data/models/email_record.dart';
import 'package:gratovo_toolbox/data/models/email_tag.dart';
import 'package:gratovo_toolbox/data/repositories/email_library_repository.dart';

/// What the app gets when there is nowhere to write: the web build, or a
/// machine whose `email_library.db` could not be opened.
///
/// Every read returns nothing and every write is silently dropped, which is
/// safe precisely *because* [isAvailable] is false and the page renders an
/// explanation instead of an editor when it is. This exists so that no caller
/// needs a null check: "the library is unavailable" is one state, expressed
/// once, rather than a nullable repository threaded through every provider.
///
/// Deliberately NOT an in-memory implementation that accepts writes. Records
/// that look saved and are gone on restart are worse than an honest "not
/// here" — the whole value of this feature is a corpus that accumulates.
class UnavailableEmailLibraryRepository implements EmailLibraryRepository {
  const UnavailableEmailLibraryRepository();

  @override
  bool get isAvailable => false;

  @override
  Future<List<EmailRecord>> listRecords({
    required EmailAudience audience,
    String? search,
    List<String> stageTagIds = const [],
    List<String> nicheTagIds = const [],
    EmailRecordSort sort = EmailRecordSort.lastEdited,
    EmailRecordSource? source,
  }) async =>
      const [];

  @override
  Future<List<EmailRecord>> listRecordsInVideoDateRange({
    required EmailAudience audience,
    required DateTime from,
    required DateTime to,
  }) async =>
      const [];

  @override
  Future<EmailVideoDateBounds?> videoDateBounds(EmailAudience audience) async =>
      null;

  @override
  Future<EmailRecord?> getRecord(String id) async => null;

  @override
  Future<void> saveRecord(EmailRecord record) async {}

  @override
  Future<void> deleteRecord(String id) async {}

  @override
  Future<int> importRecords(List<EmailRecord> records) async => 0;

  @override
  Future<void> markRecordsCopied(List<String> ids, DateTime at) async {}

  @override
  Future<Map<EmailAudience, int>> countRecords() async =>
      {for (final audience in EmailAudience.values) audience: 0};

  @override
  Future<List<EmailTag>> listTags(EmailTagKind kind) async => const [];

  @override
  Future<EmailTag> addTag({
    required EmailTagKind kind,
    required String label,
  }) async =>
      EmailTag(id: 'unavailable', kind: kind, label: label);

  @override
  Future<void> renameTag(String id, String label) async {}

  @override
  Future<void> deleteTag(String id) async {}

  @override
  Future<Map<String, int>> tagUsageCounts(EmailTagKind kind) async => const {};

  @override
  Future<EmailDraftDefaults> readDefaults(EmailAudience audience) async =>
      const EmailDraftDefaults();

  @override
  Future<void> writeDefaults(
    EmailAudience audience,
    EmailDraftDefaults value,
  ) async {}
}
