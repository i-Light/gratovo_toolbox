/// Turns one line of `search.py`'s stdout into a progress event.
///
/// The pipeline's `print()` calls are the only progress protocol a launched
/// run has (see `PipelineLaunchResult`'s doc comment), so rather than
/// regex-scraping prose that was written for a human terminal, `search.py`
/// and `pipeline.py` now emit two shapes that are deliberately both readable
/// in the log panel *and* trivially parseable here:
///
///     [keyword 3/12] started: budget travel
///     [keyword 3/12] done: budget travel
///     [step] Fetching channel details 50/100...
///     [sync-io] shared=25 of=5672
///     [backoff] total=47 remaining=45 reason=HTTP 429 from ...
///     [route] pool gateways=3 proxies=0 direct=1 gap=6 workers=3 parallel=1 pacing=normal
///     [route] use aws=12 proxy=0 direct=3 last=aws label=AWS Gateway 2 (eu-west-1)
///
/// The last is `sync.py`'s progress through a move of objects to or from the
/// bucket (`shared=` uploads, `pulled=` downloads, `catalog=` segments) and is
/// reported as a step too — a machine's first sync moves thousands of objects
/// before a run's first keyword, and it used to do so behind "Starting the
/// pipeline..." for as long as it took. Everything else is an ordinary log
/// line. Nothing in this file touches
/// `dart:io` or Flutter, so it is unit-testable on its own — which matters,
/// because a silent parse failure here would show up as a progress panel that
/// never moves rather than as an error anybody would notice.
library;

/// A parsed line. [SearchProgressEvent.none] is the overwhelmingly common
/// case and carries nothing.
sealed class SearchProgressEvent {
  const SearchProgressEvent();

  /// Not a progress line — just log output.
  static const SearchProgressEvent none = _NoProgress();
}

class _NoProgress extends SearchProgressEvent {
  const _NoProgress();
}

/// The pipeline has started working [keyword], the [index]th of [total].
class KeywordStarted extends SearchProgressEvent {
  const KeywordStarted({
    required this.keyword,
    required this.index,
    required this.total,
  });

  final String keyword;

  /// 1-based.
  final int index;
  final int total;
}

/// The pipeline has finished [keyword] and committed it.
class KeywordFinished extends SearchProgressEvent {
  const KeywordFinished({
    required this.keyword,
    required this.index,
    required this.total,
  });

  final String keyword;
  final int index;
  final int total;
}

/// What the pipeline is doing this second, in its own words.
class StepReported extends SearchProgressEvent {
  const StepReported(this.step);

  final String step;
}

/// One tick of a YouTube-rate-limit backoff wait (`scrapetube._interruptible_wait`,
/// printed every couple of seconds while `_request` waits out a throttle).
/// [totalSeconds] is the whole wait this retry chose, [remainingSeconds]
/// counts down to zero — together they're the countdown/progress bar the
/// Search screen shows instead of a run that looks stalled, and
/// [remainingSeconds] reaching a caller-visible zero (or any other line
/// arriving) is what tells the panel the wait ended.
class BackoffWaiting extends SearchProgressEvent {
  const BackoffWaiting({
    required this.totalSeconds,
    required this.remainingSeconds,
    required this.reason,
  });

  final int totalSeconds;
  final int remainingSeconds;

  /// Why the wait started, verbatim from `_raise_if_blocked`/`ThrottledError`
  /// (e.g. "HTTP 429 from ...", "redirected to YouTube's captcha page") — the
  /// only structured hint of *why* a run looks stalled, surfaced to other
  /// machines via presence so a teammate isn't left guessing "IP refused" vs.
  /// "just slow".
  final String reason;
}

/// What the run has to rotate through and how it will use it -- printed once
/// at the start (`search.py`, from `proxy_pool.format_route_pool`).
class RoutePoolReported extends SearchProgressEvent {
  const RoutePoolReported({
    required this.gateways,
    required this.proxies,
    required this.includesDirect,
    required this.gapSeconds,
    required this.workers,
    required this.parallel,
    required this.pacing,
  });

  final int gateways;
  final int proxies;
  final bool includesDirect;

  /// The minimum gap between two requests to one gateway or proxy.
  final double gapSeconds;

  /// Keywords worked at once; more than one only with parallel search on.
  final int workers;
  final bool parallel;

  /// `normal` or `fast`.
  final String pacing;
}

/// Which connections have actually carried requests so far -- cumulative
/// counts per kind and the one that carried the latest
/// (`proxy_pool.ProxyPool.route_line`). The difference between "AWS is
/// connected" and "AWS is being used".
class RouteUsed extends SearchProgressEvent {
  const RouteUsed({
    required this.awsRequests,
    required this.proxyRequests,
    required this.directRequests,
    required this.lastKind,
    required this.lastLabel,
  });

  final int awsRequests;
  final int proxyRequests;
  final int directRequests;

  /// `aws`, `proxy` or `direct`.
  final String lastKind;
  final String lastLabel;
}

/// The keywords started and not yet finished, oldest first.
///
/// One at most on an ordinary run. With parallel search several run at once,
/// and they finish in any order -- so "the current keyword" is the newest
/// one still going, and one finishing hands the headline to the next newest
/// rather than blanking it while the others carry on.
class KeywordsInFlight {
  final Map<String, int> _byKeyword = {};

  void started(String keyword, int index) {
    _byKeyword
      ..remove(keyword)
      ..[keyword] = index;
  }

  void finished(String keyword) => _byKeyword.remove(keyword);

  void clear() => _byKeyword.clear();

  bool get isEmpty => _byKeyword.isEmpty;

  /// The newest keyword still going, or null.
  String? get current => _byKeyword.isEmpty ? null : _byKeyword.keys.last;

  /// Its 1-based position in the run's list, or null.
  int? get currentIndex => _byKeyword.isEmpty ? null : _byKeyword.values.last;

  List<String> get keywords => List.unmodifiable(_byKeyword.keys);
}

/// `[keyword 3/12] started: budget travel`. The keyword itself is captured
/// greedily to end-of-line: keywords are free text and routinely contain
/// colons ("2026: the year of...").
final _keywordPattern =
    RegExp(r'^\[keyword (\d+)/(\d+)\] (started|done): (.*)$');

final _stepPattern = RegExp(r'^\[step\] (.*)$');

final _backoffPattern =
    RegExp(r'^\[backoff\] total=(\d+) remaining=(\d+) reason=(.*)$');

final _routePoolPattern = RegExp(
  r'^\[route\] pool gateways=(\d+) proxies=(\d+) direct=([01]) '
  r'gap=([\d.]+) workers=(\d+) parallel=([01]) pacing=(\w+)$',
);

/// The label runs to end-of-line: it is free text ("AWS Gateway 2
/// (eu-west-1)", a proxy's own label).
final _routeUsePattern = RegExp(
  r'^\[route\] use aws=(\d+) proxy=(\d+) direct=(\d+) last=(\w*) label=(.*)$',
);

final _syncIoPattern =
    RegExp(r'^\[sync-io\] (shared|pulled|catalog)=(\d+) of=(\d+)$');

/// The step one `[sync-io]` line reports, in words. `pulled=0 of=3000` at the
/// start of a download reads as "0 of 3,000", which is the honest position.
String describeSyncIo(String kind, int done, int total) {
  final progress = '$done of $total';
  return switch (kind) {
    'shared' => "Uploading this machine's channels ($progress)...",
    'pulled' => "Downloading the team's channels ($progress)...",
    _ => "Applying the team's catalog ($progress)...",
  };
}

/// The kind of refusal behind a [BackoffWaiting.reason]/
/// [SearchingStatus.backoffReason] — coarse enough to have a translated
/// phrase for each ([AppLocalizations.searchBackoffReasonRateLimited] etc.),
/// since the pipeline's own text ("HTTP 429 from https://...") is accurate
/// but written for a log, not a teammate glancing at your run.
enum BackoffReasonKind {
  /// A 429/403 — YouTube (or a proxy in front of it) refusing the request
  /// outright, the "IP got refused" case.
  rateLimited,

  /// A captcha interstitial or "unusual traffic" page.
  captcha,

  /// Anything else — shown as the raw reason text.
  other,
}

BackoffReasonKind classifyBackoffReason(String reason) {
  final lower = reason.toLowerCase();
  if (lower.contains('429') || lower.contains('403')) {
    return BackoffReasonKind.rateLimited;
  }
  if (lower.contains('captcha') || lower.contains('unusual traffic')) {
    return BackoffReasonKind.captcha;
  }
  return BackoffReasonKind.other;
}

SearchProgressEvent parseSearchProgressLine(String line) {
  final trimmed = line.trim();

  final keywordMatch = _keywordPattern.firstMatch(trimmed);
  if (keywordMatch != null) {
    final index = int.tryParse(keywordMatch.group(1)!);
    final total = int.tryParse(keywordMatch.group(2)!);
    final keyword = keywordMatch.group(4)!.trim();
    if (index != null && total != null && keyword.isNotEmpty) {
      return keywordMatch.group(3) == 'started'
          ? KeywordStarted(keyword: keyword, index: index, total: total)
          : KeywordFinished(keyword: keyword, index: index, total: total);
    }
    return SearchProgressEvent.none;
  }

  final backoffMatch = _backoffPattern.firstMatch(trimmed);
  if (backoffMatch != null) {
    final total = int.tryParse(backoffMatch.group(1)!);
    final remaining = int.tryParse(backoffMatch.group(2)!);
    final reason = backoffMatch.group(3)!.trim();
    if (total != null && remaining != null) {
      return BackoffWaiting(
        totalSeconds: total,
        remainingSeconds: remaining,
        reason: reason,
      );
    }
    return SearchProgressEvent.none;
  }

  final useMatch = _routeUsePattern.firstMatch(trimmed);
  if (useMatch != null) {
    return RouteUsed(
      awsRequests: int.parse(useMatch.group(1)!),
      proxyRequests: int.parse(useMatch.group(2)!),
      directRequests: int.parse(useMatch.group(3)!),
      lastKind: useMatch.group(4)!,
      lastLabel: useMatch.group(5)!.trim(),
    );
  }

  final poolMatch = _routePoolPattern.firstMatch(trimmed);
  if (poolMatch != null) {
    return RoutePoolReported(
      gateways: int.parse(poolMatch.group(1)!),
      proxies: int.parse(poolMatch.group(2)!),
      includesDirect: poolMatch.group(3) == '1',
      gapSeconds: double.tryParse(poolMatch.group(4)!) ?? 0,
      workers: int.parse(poolMatch.group(5)!),
      parallel: poolMatch.group(6) == '1',
      pacing: poolMatch.group(7)!,
    );
  }

  final stepMatch = _stepPattern.firstMatch(trimmed);
  if (stepMatch != null) {
    final step = stepMatch.group(1)!.trim();
    if (step.isNotEmpty) return StepReported(step);
  }

  final syncMatch = _syncIoPattern.firstMatch(trimmed);
  if (syncMatch != null) {
    final done = int.tryParse(syncMatch.group(2)!);
    final total = int.tryParse(syncMatch.group(3)!);
    if (done != null && total != null) {
      return StepReported(describeSyncIo(syncMatch.group(1)!, done, total));
    }
  }

  return SearchProgressEvent.none;
}
