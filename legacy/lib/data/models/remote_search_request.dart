import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// Whether a [RemoteSearchRequest] still needs to be picked up, or has
/// already been acted on by the machine it was sent to.
enum RemoteSearchRequestStatus {
  pending,
  applied,
  dismissed;

  static RemoteSearchRequestStatus fromWire(String? raw) => switch (raw) {
        'applied' => RemoteSearchRequestStatus.applied,
        'dismissed' => RemoteSearchRequestStatus.dismissed,
        _ => RemoteSearchRequestStatus.pending,
      };

  String get wire => name;
}

/// One person handing another a keyword list to run on their machine: a
/// `public.remote_search_requests` row.
///
/// [keywords] is newline-separated, the same shape the Search screen's
/// keyword box already persists (`SearchKeywordsState`), so a receiving
/// machine can hand it straight to `SearchKeywordsNotifier.setText` without
/// reparsing anything. Never deleted — [status] moves from `pending` to
/// `applied`/`dismissed` and the row stays as a record of what was sent.
class RemoteSearchRequest {
  const RemoteSearchRequest({
    required this.id,
    required this.fromUserId,
    required this.toUserId,
    required this.keywords,
    required this.status,
    required this.createdAt,
    this.appliedAt,
  });

  final String id;
  final String fromUserId;
  final String toUserId;
  final String keywords;
  final RemoteSearchRequestStatus status;
  final DateTime createdAt;
  final DateTime? appliedAt;

  static RemoteSearchRequest fromRow(Map<String, dynamic> row) {
    return RemoteSearchRequest(
      id: row['id'] as String,
      fromUserId: row['from_user_id'] as String,
      toUserId: row['to_user_id'] as String,
      keywords: parseString(row['keywords']) ?? '',
      status: RemoteSearchRequestStatus.fromWire(row['status'] as String?),
      createdAt: parseDate(row['created_at']) ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      appliedAt: parseDate(row['applied_at']),
    );
  }
}
