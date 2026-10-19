import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_settings_controller.dart';

/// Where the one auto-resume attempt this app launch got to.
enum SearchResumeStatus {
  /// Not tried yet, or nothing to do.
  idle,

  /// The remaining keywords of an interrupted run were relaunched.
  resumed,

  /// The launch was attempted and threw. The interrupted-run marker is left
  /// set, so the next launch will try the resume again.
  failed,
}

/// Relaunches, once per app launch, a discovery run the previous session was
/// still running when it was killed — the app closed mid-run, a crash, the
/// machine losing power.
///
/// It reads exactly one thing: [SearchKeywordsState.wasInterrupted], which is
/// true only when the persisted "a run is in progress" marker
/// ([SearchKeywordsNotifier.markRunStarted]) was still set at load. Only a run
/// the user *stopped* by hand, or one that *finished its list*, clears that
/// marker on its way out (see `active_search_run_controller.dart`); a run that
/// crashed or fell over on its own leaves it set, so it is resumed just like a
/// session that was killed mid-run.
///
/// The remaining keywords, the completed list and the total all come from the
/// same persisted [searchKeywordsProvider] the manual Resume button uses, so an
/// auto-resumed run counts "5/12" the same way. Per-run search settings are not
/// persisted anywhere, so a resumed run uses the defaults — identical to
/// pressing Resume by hand after a restart.
class SearchResumeNotifier extends Notifier<SearchResumeStatus> {
  /// One attempt per app launch, whatever the outcome.
  bool _attempted = false;

  @override
  SearchResumeStatus build() => SearchResumeStatus.idle;

  /// Call from the app chrome once the UI is up. Safe to call on every
  /// rebuild — it acts at most once, and does nothing off a build that cannot
  /// launch the search process.
  Future<void> resumeIfInterrupted({required String startedByLabel}) async {
    if (_attempted) return;
    _attempted = true;

    if (!ref.read(capabilitiesProvider).canRunSearch) return;

    final keywords = await _loadedKeywords();
    if (keywords == null || !keywords.wasInterrupted) return;

    final pending = keywords.pending;
    if (pending.isEmpty) {
      // The run was cut off after its last keyword — nothing left to work, just
      // tidy the marker away.
      unawaited(ref.read(searchKeywordsProvider.notifier).markRunEnded());
      return;
    }

    // A run is somehow already going (a very fast manual Start beat us to it).
    // Leave it be — its own marker write covers the resume case.
    if (ref.read(activeSearchRunControllerProvider.notifier).isRunning) return;

    final settings = ref.read(searchSettingsProvider);
    try {
      await ref.read(activeSearchRunControllerProvider.notifier).startSearch(
            keywords: pending,
            runConfigJson: settings.toRunConfigJson(),
            startedByLabel: startedByLabel,
            keywordTotal: keywords.keywords.length,
            alreadyCompleted: keywords.completed,
          );
      ref.read(activityLoggerProvider).searchStarted(keywords: pending);
      state = SearchResumeStatus.resumed;
    } catch (error, stackTrace) {
      developer.log(
        'Could not auto-resume the interrupted search.',
        name: 'gratovo.search.resume',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      // The marker is left set. A failed relaunch is not a deliberate end, so
      // the next launch should try to resume again rather than silently drop
      // the unfinished run.
      state = SearchResumeStatus.failed;
    }
  }

  /// The saved keyword state, waiting out its one-time load off
  /// `SharedPreferences`. Returns null if it never loads.
  Future<SearchKeywordsState?> _loadedKeywords() async {
    for (var i = 0; i < 50; i++) {
      final current = ref.read(searchKeywordsProvider);
      if (current.loaded) return current;
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    return null;
  }
}

final searchResumeControllerProvider =
    NotifierProvider<SearchResumeNotifier, SearchResumeStatus>(
  SearchResumeNotifier.new,
);
