import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/remote_search_request.dart';
import 'package:gratovo_toolbox/data/repositories/remote_search_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_launch.dart';

/// Picks up keyword lists other team members have sent this machine
/// (`remote_search_requests`, addressed by `to_user_id`) and acts on them —
/// the receiving side of the Search screen's upload button.
///
/// What "acting on them" means depends on what this machine is doing when a
/// request arrives, all via the ordinary keyword box rather than any live
/// hand-off into a running process (there isn't one — see `search_launch.dart`
/// and `pipeline/search.py`'s one-shot keyword read):
///  * idle, nothing resumable — merge the keywords in and start fresh.
///  * idle, a previous run left something resumable — merge the keywords in
///    and resume, same call either way (`launchPendingSearch`).
///  * a run is already going — merge the keywords in and stop there;
///    `searchAutoChainControllerProvider` picks them up the moment the
///    in-flight run ends, exactly like a keyword typed in by hand mid-run.
///
/// Merging happens even in the third case because that's the one genuinely
/// asynchronous part: the request is marked `applied` as soon as its
/// keywords are safely in the box, since that's the point of no return —
/// the actual launch might still be seconds or minutes away, or fail for
/// reasons unrelated to the request itself (see `SearchResumeNotifier` for
/// the same reasoning about a launch failure not being worth un-doing).
///
/// Lives for the app session (watched once from `app_shell.dart`), not the
/// Search screen — the whole point of a remote request is that nobody needs
/// to be looking at this machine for it to land.
class RemoteSearchIntakeNotifier extends Notifier<void> {
  bool _processing = false;

  @override
  void build() {
    // Re-checks whenever a pull brings in a new/changed row. The first
    // `build()` call (every app launch) also runs this once, which is what
    // picks up a request that arrived while nobody was running the app.
    ref.watch(dataRevisionProvider(DataDomain.remoteSearchRequests));
    scheduleMicrotask(_checkIncoming);
  }

  Future<void> _checkIncoming() async {
    if (_processing) return;
    _processing = true;
    try {
      if (!ref.read(capabilitiesProvider).canRunSearch) return;

      final repo = ref.read(remoteSearchRepositoryProvider);
      final List<RemoteSearchRequest> incoming;
      try {
        incoming = await repo.incomingPending();
      } catch (error, stackTrace) {
        developer.log(
          'Could not read incoming remote search requests.',
          name: 'gratovo.search.remoteIntake',
          level: 900,
          error: error,
          stackTrace: stackTrace,
        );
        return;
      }
      if (incoming.isEmpty) return;

      final keywordsState = await _loadedKeywords();
      if (keywordsState == null) return;

      for (final request in incoming) {
        await _apply(request, repo);
      }
    } finally {
      _processing = false;
    }
  }

  Future<void> _apply(
    RemoteSearchRequest request,
    RemoteSearchRepository repo,
  ) async {
    final notifier = ref.read(searchKeywordsProvider.notifier);
    final current = ref.read(searchKeywordsProvider);
    final merged = _mergeKeywords(current.text, request.keywords);
    if (merged != current.text) notifier.setText(merged);

    final wasRunning =
        ref.read(activeSearchRunControllerProvider.notifier).isRunning;
    try {
      await repo.markApplied(request.id);
    } catch (error, stackTrace) {
      developer.log(
        'Could not mark a remote search request applied.',
        name: 'gratovo.search.remoteIntake',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }

    // Already running: leave it to `searchAutoChainControllerProvider` once
    // the in-flight run ends -- starting another process now would race it.
    if (wasRunning) return;

    try {
      await launchPendingSearch(ref, startedByLabel: 'This device');
    } catch (error, stackTrace) {
      developer.log(
        'Could not start/resume for an incoming remote search request.',
        name: 'gratovo.search.remoteIntake',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// The saved keyword state, waiting out its one-time load off
  /// `SharedPreferences` — same polling `SearchResumeNotifier` uses, since
  /// merging into [SearchKeywordsState.text] before it has loaded would be
  /// overwritten the moment the real saved text loads.
  Future<SearchKeywordsState?> _loadedKeywords() async {
    for (var i = 0; i < 50; i++) {
      final current = ref.read(searchKeywordsProvider);
      if (current.loaded) return current;
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    return null;
  }

  /// Appends whichever of [incomingText]'s keywords aren't already in
  /// [currentText], in order, verbatim — so a repeat send (or one that
  /// overlaps an already-typed keyword) doesn't duplicate lines.
  static String _mergeKeywords(String currentText, String incomingText) {
    final present = SearchKeywordsState(text: currentText).keywords.toSet();
    final incoming = SearchKeywordsState(text: incomingText).keywords;
    final toAdd = [
      for (final keyword in incoming)
        if (!present.contains(keyword)) keyword,
    ];
    if (toAdd.isEmpty) return currentText;
    final trimmed = currentText.trimRight();
    return trimmed.isEmpty ? toAdd.join('\n') : '$trimmed\n${toAdd.join('\n')}';
  }
}

final remoteSearchIntakeControllerProvider =
    NotifierProvider<RemoteSearchIntakeNotifier, void>(
  RemoteSearchIntakeNotifier.new,
);
