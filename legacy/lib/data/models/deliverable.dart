/// What kind of content a [Deliverable] is.
enum DeliverableType {
  integration,
  dedicated,
  short,
  communityPost,
  other;
}

/// Where one [Deliverable] is in its own small pipeline, independent of the
/// [Deal]'s own [DealStage] — a deal can be `signed` while its deliverables
/// are still `pending`/`drafted`.
enum DeliverableStatus {
  pending,
  drafted,
  approved,
  published;
}

/// One agreed-upon piece of content within a [Deal]. A deal for "an
/// integration plus two community posts" is one [Deal] row and three
/// `Deliverable` rows, each tracked to draft/approve/publish on its own
/// timeline — see `Deal.deliverables`, the old freeform text field this
/// supersedes for any deal that wants per-item tracking rather than a
/// paragraph.
class Deliverable {
  const Deliverable({
    required this.id,
    required this.dealId,
    required this.createdAt,
    required this.updatedAt,
    this.type = DeliverableType.other,
    this.agreedDate,
    this.draftReceivedDate,
    this.approvedDate,
    this.publishedUrl,
    this.status = DeliverableStatus.pending,
    this.notes,
    this.sortOrder = 0,
    this.publishedAt,
    this.reportViews,
    this.reportViewsAt,
    this.reportClicks,
  });

  final String id;
  final String dealId;
  final DeliverableType type;

  /// When this deliverable was agreed as part of the deal — not necessarily
  /// [Deal.createdAt]; deliverables can be added to a deal after the fact.
  final DateTime? agreedDate;
  final DateTime? draftReceivedDate;
  final DateTime? approvedDate;

  /// Link to the live content, once published.
  final String? publishedUrl;

  /// When it was marked published; the 30-day report is due 30 days later.
  final DateTime? publishedAt;

  /// The video's views when the 30-day report was taken — a snapshot, kept
  /// as it was rather than overwritten by a later fetch.
  final int? reportViews;
  final DateTime? reportViewsAt;

  /// Clicks on the deal's tracking link, as a person read them off it.
  final int? reportClicks;

  final DeliverableStatus status;
  final String? notes;

  /// The team's own working order within a deal — not necessarily the order
  /// the dates above suggest; matches the `sort_order` idiom
  /// `WritingRulesRepository` already uses for an ordered list.
  final int sortOrder;

  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isPublished => status == DeliverableStatus.published;

  /// The day the 30-day report is due, once published.
  DateTime? get reportDueAt => publishedAt?.add(const Duration(days: 30));

  bool get hasReport => reportViewsAt != null;

  /// [id], [dealId] and [createdAt] are identity and never change.
  /// [updatedAt] defaults to now — the same opt-out rule as [Deal.copyWith].
  Deliverable copyWith({
    DeliverableType? type,
    DateTime? agreedDate,
    DateTime? draftReceivedDate,
    DateTime? approvedDate,
    String? publishedUrl,
    DeliverableStatus? status,
    String? notes,
    int? sortOrder,
    DateTime? updatedAt,
  }) {
    return Deliverable(
      id: id,
      dealId: dealId,
      type: type ?? this.type,
      agreedDate: agreedDate ?? this.agreedDate,
      draftReceivedDate: draftReceivedDate ?? this.draftReceivedDate,
      approvedDate: approvedDate ?? this.approvedDate,
      publishedUrl: publishedUrl ?? this.publishedUrl,
      status: status ?? this.status,
      notes: notes ?? this.notes,
      sortOrder: sortOrder ?? this.sortOrder,
      publishedAt: publishedAt,
      reportViews: reportViews,
      reportViewsAt: reportViewsAt,
      reportClicks: reportClicks,
      createdAt: createdAt,
      updatedAt: updatedAt ?? DateTime.now(),
    );
  }
}
