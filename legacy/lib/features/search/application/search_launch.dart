import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/features/archive/application/archive_controller.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/auto_clean_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_settings_controller.dart';

/// Launches whatever [SearchKeywordsState.pending] currently holds — a fresh
/// start when nothing is completed yet, a resume when something is.
///
/// The one call both cases share: the pipeline draws no distinction between
/// them, only between "the whole list" and "what's left of it" — see
/// `search_screen.dart`'s `_startSearch`, which this mirrors so a chained or
/// remotely-triggered run is launched exactly like a manual Start/Resume
/// click would. A no-op if nothing is pending.
Future<void> launchPendingSearch(Ref ref,
    {required String startedByLabel}) async {
  final saved = ref.read(searchKeywordsProvider);
  final toRun = saved.pending;
  if (toRun.isEmpty) return;

  final settings = ref.read(searchSettingsProvider);
  final runConfig = settings.toRunConfigJson();
  if (ref.read(canBulkCleanProvider)) {
    final gate = ref.read(autoCleanRuleProvider).toRunConfigJson();
    if (gate != null) runConfig['auto_clean'] = gate;
  }

  await ref.read(activeSearchRunControllerProvider.notifier).startSearch(
        keywords: toRun,
        runConfigJson: runConfig,
        startedByLabel: startedByLabel,
        keywordTotal: saved.keywords.length,
        alreadyCompleted: saved.completed,
      );
  ref.read(activityLoggerProvider).searchStarted(keywords: toRun);
}
