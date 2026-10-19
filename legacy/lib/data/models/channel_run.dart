/// Lifecycle of one single-channel pipeline job: a backfill
/// (`tools/enrich.py --only backfill`) or a re-enrich
/// (`search.py --refetch <handle>`).
enum ChannelRunStatus {
  running,
  completed,

  /// The process exited non-zero, or could not be launched at all.
  failed;

  bool get isFinished => this != running;
}

/// Which job a [ChannelRun] is. The two share one shape and one progress
/// panel; only where they start from, what they launch and what they say when
/// they finish differ.
enum ChannelRunKind {
  /// "Pull more videos" from an Influencer Profile: walks the channel's older
  /// uploads back [ChannelRun.months] months.
  backfill,

  /// "Free this channel from the archive" from the Archive page: the ordinary
  /// discovery fetch (channel metadata + the recent uploads window).
  reenrich,
}

/// The live view of one single-channel run, started from wherever the
/// channel was and watched from the Search page — see `ChannelRunNotifier`.
///
/// Mirrors the shape of [SearchRun] (data/models/search_run.dart) at a much
/// smaller scale: one channel, not a keyword list, so there is no per-item
/// progress to track — only the raw log, the last `[step]` line and, for a
/// backfill, the "saved N video(s)" count once its summary line has printed.
class ChannelRun {
  const ChannelRun({
    required this.id,
    required this.kind,
    required this.handle,
    required this.startedAt,
    required this.status,
    this.months,
    this.finishedAt,
    this.logLines = const [],
    this.currentStep,
    this.videosAdded,
  });

  final String id;
  final ChannelRunKind kind;
  final String handle;

  /// How far back a backfill walks. Null for a re-enrich, which has no window.
  final int? months;

  final DateTime startedAt;
  final DateTime? finishedAt;
  final ChannelRunStatus status;
  final List<String> logLines;

  /// The last `[step]` line the run printed — the pacing announcements
  /// `pipeline.py` prints while scraping an upload list, or the two
  /// `run_manual_refetch` emits around its fetches.
  final String? currentStep;

  /// Parsed out of enrich.py's own "backfill : saved N video(s) across ..."
  /// summary line once it has printed. Null until then, and always null for a
  /// re-enrich, which prints no such line.
  final int? videosAdded;

  ChannelRun copyWith({
    DateTime? finishedAt,
    ChannelRunStatus? status,
    List<String>? logLines,
    String? currentStep,
    int? videosAdded,
    bool clearCurrentStep = false,
  }) {
    return ChannelRun(
      id: id,
      kind: kind,
      handle: handle,
      months: months,
      startedAt: startedAt,
      finishedAt: finishedAt ?? this.finishedAt,
      status: status ?? this.status,
      logLines: logLines ?? this.logLines,
      currentStep: clearCurrentStep ? null : (currentStep ?? this.currentStep),
      videosAdded: videosAdded ?? this.videosAdded,
    );
  }
}
