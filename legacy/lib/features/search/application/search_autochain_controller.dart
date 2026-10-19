import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_launch.dart';

/// Chains the next run the moment one finishes its whole list, if keywords
/// are still waiting — typed in mid-run by hand, or merged in by
/// [RemoteSearchIntakeController] (`remote_search_intake_controller.dart`)
/// from a request another machine sent.
///
/// Lives for the app session (watched once from `app_shell.dart`), not the
/// Search screen. Keywords appended while that screen is closed — the usual
/// case for a request sent from another machine, since nobody needs to be
/// looking at it there for the run to matter — still have to be picked up
/// the moment the in-flight run ends; a listener scoped to the screen's
/// State would miss that. This is the single owner of that decision: it
/// used to live in the Search screen's own `ref.listen`, duplicated here
/// would risk two runs launching for the same finished keyword.
class SearchAutoChainNotifier extends Notifier<void> {
  /// Set once from `app_shell.dart`, which has the localized string. Falls
  /// back to the untranslated English default if a chain happens to fire
  /// before that — the field is cosmetic (`SearchRun.startedBy` isn't shown
  /// anywhere in the UI yet), so this is a defensive fallback, not a path
  /// that matters in practice.
  String _startedByLabel = 'This device';

  void setStartedByLabel(String label) {
    _startedByLabel = label;
  }

  @override
  void build() {
    ref.listen<SearchRun?>(activeSearchRunControllerProvider, (previous, next) {
      if (next == null) return;
      if (previous?.status != SearchRunStatus.running) return;
      if (next.status != SearchRunStatus.completed) return;

      // A run that finished the whole list has nothing left to resume from;
      // leaving every keyword marked done would make the next Start refuse
      // to run anything until the box was edited.
      final stillPending = ref.read(searchKeywordsProvider).pending;
      if (stillPending.isEmpty) {
        ref.read(searchKeywordsProvider.notifier).clearProgress();
        return;
      }
      if (!ref.read(capabilitiesProvider).canEditSearchInputs) return;
      unawaited(_chain());
    });
  }

  Future<void> _chain() async {
    try {
      await launchPendingSearch(ref, startedByLabel: _startedByLabel);
    } catch (error, stackTrace) {
      developer.log(
        'Could not auto-chain the next run.',
        name: 'gratovo.search.autochain',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final searchAutoChainControllerProvider =
    NotifierProvider<SearchAutoChainNotifier, void>(
        SearchAutoChainNotifier.new);
