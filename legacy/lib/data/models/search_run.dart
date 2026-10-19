/// Lifecycle of one keyword-search execution of the Python pipeline.
enum SearchRunStatus {
  idle,
  running,
  completed,

  /// The process exited non-zero on its own.
  failed,

  /// Somebody pressed Stop. Deliberately distinct from [failed]: a stopped
  /// run kept everything it had already committed and is the normal way to
  /// end a long run early, so it should not be reported as a breakage — and
  /// it is the case the keyword box resumes from.
  stopped;

  bool get isFinished => this != running && this != idle;
}

/// One "Start Searching" run — the live view while it is going, and the
/// summary afterwards.
///
/// Everything below [logLines] is *live progress*, parsed out of the running
/// process' own stdout by `search_progress_parser.dart` (see `search.py`'s
/// `[keyword i/n]` prints and `pipeline.py`'s `[step]` prints). It exists
/// because the panel used to have nothing to show but a raw log: a run was
/// either "running" or "done", with no way to see which keyword it was on or
/// what it was doing, and — since Python block-buffers a piped stdout — even
/// the log arrived in one lump at the end.
class SearchRun {
  const SearchRun({
    required this.id,
    required this.keywords,
    required this.startedBy,
    required this.startedAt,
    required this.status,
    this.finishedAt,
    this.channelsFound = 0,
    this.videosFound = 0,
    this.logLines = const [],
    this.currentKeyword,
    this.currentKeywordIndex = 0,
    this.keywordTotal = 0,
    this.completedKeywords = const [],
    this.keywordsDone = 0,
    this.currentStep,
    this.backoffTotalSeconds,
    this.backoffRemainingSeconds,
    this.backoffReason,
    this.activeKeywords = const [],
    this.route,
  });

  final String id;
  final List<String> keywords;
  final String startedBy;
  final DateTime startedAt;
  final DateTime? finishedAt;
  final SearchRunStatus status;
  final int channelsFound;
  final int videosFound;
  final List<String> logLines;

  /// The keyword being worked right now, verbatim as it was sent to the
  /// pipeline — which is what lets the keyword box highlight the matching
  /// line. Null before the first keyword starts and after the run ends.
  final String? currentKeyword;

  /// 1-based position of [currentKeyword] within the whole keyword list, so it
  /// pairs with [keywordTotal]. A resumed run is handed only what is left but
  /// still counts from where it picked up: resuming a 12-keyword list at number
  /// six reads "6", not "1" (see `active_search_run_controller.dart`).
  final int currentKeywordIndex;

  /// How many keywords this run was given. Not necessarily the number of
  /// lines in the keyword box: a resumed run is handed only what is left.
  final int keywordTotal;

  /// Keywords this run has finished, in completion order. Only a run this
  /// session is watching knows the names; a run read back from `gratovo.db`
  /// after a restart has the count and nothing else, which is what
  /// [keywordsDone] is for.
  final List<String> completedKeywords;

  /// How many keywords are finished. Kept alongside [completedKeywords]
  /// rather than derived from it precisely because the two sources differ:
  /// `store.py`'s `runs` table records `keywords_done` as a number and never
  /// records which ones, so deriving this from the name list would report a
  /// restored run as having finished nothing.
  final int keywordsDone;

  /// The last `[step]` line — what the pipeline is doing this second
  /// ("Scanned 240 search result(s)...", "Fetching channel details 50/100...").
  final String? currentStep;

  /// The whole length of the wait a YouTube rate-limit retry is currently
  /// sitting out, in seconds — null whenever a request isn't being retried.
  /// Pairs with [backoffRemainingSeconds] for the countdown/progress bar the
  /// panel shows in place of a run that would otherwise look stalled (see
  /// `search_progress_parser.dart`'s `BackoffWaiting`).
  final int? backoffTotalSeconds;

  /// How much of [backoffTotalSeconds] is left. Both are cleared together the
  /// moment any other line arrives — the retry succeeded, failed a different
  /// way, or the run ended.
  final int? backoffRemainingSeconds;

  /// Why the current wait started (e.g. "HTTP 429 from ...", "redirected to
  /// YouTube's captcha page") — the pipeline's own reason text, verbatim.
  /// Cleared alongside the other two.
  final String? backoffReason;

  /// Every keyword in flight right now, oldest first. One at most on an
  /// ordinary run; with parallel search, up to one per worker --
  /// [currentKeyword] is then the most recently started of them.
  final List<String> activeKeywords;

  /// Which connections this run rotates through and which it has actually
  /// used (`[route]` lines). Null until the run says, and for runs from
  /// before those lines existed.
  final SearchRouteUsage? route;

  SearchRun copyWith({
    DateTime? finishedAt,
    SearchRunStatus? status,
    int? channelsFound,
    int? videosFound,
    List<String>? logLines,
    String? currentKeyword,
    int? currentKeywordIndex,
    int? keywordTotal,
    List<String>? completedKeywords,
    int? keywordsDone,
    String? currentStep,
    int? backoffTotalSeconds,
    int? backoffRemainingSeconds,
    String? backoffReason,
    List<String>? activeKeywords,
    SearchRouteUsage? route,
    // `copyWith` cannot express "set this back to null" through a nullable
    // parameter, and the end of a run has to clear both — otherwise a
    // finished run keeps claiming it is working the last keyword it touched.
    bool clearCurrentKeyword = false,
    bool clearCurrentStep = false,
    bool clearBackoff = false,
  }) {
    return SearchRun(
      id: id,
      keywords: keywords,
      startedBy: startedBy,
      startedAt: startedAt,
      finishedAt: finishedAt ?? this.finishedAt,
      status: status ?? this.status,
      channelsFound: channelsFound ?? this.channelsFound,
      videosFound: videosFound ?? this.videosFound,
      logLines: logLines ?? this.logLines,
      currentKeyword:
          clearCurrentKeyword ? null : (currentKeyword ?? this.currentKeyword),
      currentKeywordIndex: currentKeywordIndex ?? this.currentKeywordIndex,
      keywordTotal: keywordTotal ?? this.keywordTotal,
      completedKeywords: completedKeywords ?? this.completedKeywords,
      keywordsDone:
          keywordsDone ?? completedKeywords?.length ?? this.keywordsDone,
      currentStep: clearCurrentStep ? null : (currentStep ?? this.currentStep),
      backoffTotalSeconds: clearBackoff
          ? null
          : (backoffTotalSeconds ?? this.backoffTotalSeconds),
      backoffRemainingSeconds: clearBackoff
          ? null
          : (backoffRemainingSeconds ?? this.backoffRemainingSeconds),
      backoffReason:
          clearBackoff ? null : (backoffReason ?? this.backoffReason),
      activeKeywords: activeKeywords ?? this.activeKeywords,
      route: route ?? this.route,
    );
  }
}

/// A run's connections: what it had ([gateways], [proxies], this machine) and
/// what actually carried its requests ([awsRequests] and the rest). The
/// Search page shows the second, which is the point -- "AWS connected" said
/// nothing about whether a single request went through it.
class SearchRouteUsage {
  const SearchRouteUsage({
    this.gateways = 0,
    this.proxies = 0,
    this.includesDirect = true,
    this.gapSeconds = 0,
    this.workers = 1,
    this.parallel = false,
    this.pacing = 'normal',
    this.awsRequests = 0,
    this.proxyRequests = 0,
    this.directRequests = 0,
    this.lastKind,
    this.lastLabel,
  });

  final int gateways;
  final int proxies;
  final bool includesDirect;
  final double gapSeconds;
  final int workers;
  final bool parallel;

  /// `normal` or `fast`.
  final String pacing;

  final int awsRequests;
  final int proxyRequests;
  final int directRequests;

  /// `aws`, `proxy` or `direct` -- what carried the latest request.
  final String? lastKind;
  final String? lastLabel;

  /// Anything besides this machine to rotate through.
  bool get rotates => gateways + proxies > 0;

  SearchRouteUsage copyWith({
    int? gateways,
    int? proxies,
    bool? includesDirect,
    double? gapSeconds,
    int? workers,
    bool? parallel,
    String? pacing,
    int? awsRequests,
    int? proxyRequests,
    int? directRequests,
    String? lastKind,
    String? lastLabel,
  }) {
    return SearchRouteUsage(
      gateways: gateways ?? this.gateways,
      proxies: proxies ?? this.proxies,
      includesDirect: includesDirect ?? this.includesDirect,
      gapSeconds: gapSeconds ?? this.gapSeconds,
      workers: workers ?? this.workers,
      parallel: parallel ?? this.parallel,
      pacing: pacing ?? this.pacing,
      awsRequests: awsRequests ?? this.awsRequests,
      proxyRequests: proxyRequests ?? this.proxyRequests,
      directRequests: directRequests ?? this.directRequests,
      lastKind: lastKind ?? this.lastKind,
      lastLabel: lastLabel ?? this.lastLabel,
    );
  }
}
