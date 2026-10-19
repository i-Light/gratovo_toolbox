import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _textKey = 'gratovo.search.keywordsText';
const _completedKey = 'gratovo.search.completedKeywords';

/// Set to `true` on disk the moment a search process starts and back to
/// `false` only when the run ends deliberately — it worked through its whole
/// keyword list, or Stop was pressed. A run that crashed or exited non-zero on
/// its own leaves it set, the same as a session killed mid-run (app closed,
/// crash, power loss), so finding it still set at the next launch is exactly
/// the "it stopped while it was searching, and not because anyone asked it to"
/// signal, told apart from a deliberate Stop.
const _runInFlightKey = 'gratovo.search.runInFlight';

/// The keyword box's contents and how far the last run got through them —
/// both persisted per device.
///
/// Two problems this solves, which are really the same problem. A discovery
/// run is long, and a list of keywords is real work to assemble: closing the
/// app, or having a run die at keyword nine of forty, used to throw both away.
/// The box now comes back exactly as it was left, and a run started against a
/// list that is partly done picks up from the keyword it was cut off on rather
/// than re-scraping the eight before it.
///
/// [completed] is deliberately a list of the keywords themselves, not an
/// index. The box is editable between runs — lines get added, removed and
/// reordered — and an index into a list that has since changed points at the
/// wrong keyword, silently. Matching on the text cannot drift: a keyword that
/// is no longer in the box simply stops counting (see [prune]).
class SearchKeywordsState {
  const SearchKeywordsState({
    this.text = '',
    this.completed = const [],
    this.wasInterrupted = false,
    this.loaded = false,
  });

  /// The keyword box verbatim, blank lines and all — restored character for
  /// character, since half-written lines and grouping blank lines are part of
  /// what someone left behind.
  final String text;

  /// Keywords already finished against the current [text], in completion
  /// order.
  final List<String> completed;

  /// True only when the persisted "a run is in progress" marker
  /// ([_runInFlightKey]) was still set as this state loaded — meaning a search
  /// was running and did not end because someone stopped it or because it
  /// finished its list (a kill mid-run, a crash, a power loss, or the pipeline
  /// falling over on its own all count). The resume controller reads it once at
  /// startup to relaunch the remaining [pending] keywords on its own. Always
  /// false once a run has started or ended in this session.
  final bool wasInterrupted;

  /// False until the persisted values have been read. The keyword box seeds
  /// itself from [text] exactly once, when this flips — seeding on a `build()`
  /// that has not loaded yet would blank the box and then persist the blank.
  final bool loaded;

  /// One keyword per non-blank line, trimmed, in order, duplicates removed —
  /// the same normalization `normalizeKeywords` applies before the list is
  /// written to disk, so what is counted here is what actually runs.
  List<String> get keywords {
    final seen = <String>{};
    final result = <String>[];
    for (final line in text.split('\n')) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) continue;
      if (seen.add(trimmed)) result.add(trimmed);
    }
    return result;
  }

  /// What a Start click would actually run: everything not already done,
  /// in the box's own order.
  List<String> get pending {
    final done = completed.toSet();
    return [
      for (final keyword in keywords)
        if (!done.contains(keyword)) keyword,
    ];
  }

  /// True when a previous run got partway and there is still something left —
  /// the state the Start button offers to resume from.
  bool get hasResumableProgress =>
      completed.isNotEmpty &&
      pending.isNotEmpty &&
      pending.length < keywords.length;

  SearchKeywordsState copyWith({
    String? text,
    List<String>? completed,
    bool? wasInterrupted,
    bool? loaded,
  }) {
    return SearchKeywordsState(
      text: text ?? this.text,
      completed: completed ?? this.completed,
      wasInterrupted: wasInterrupted ?? this.wasInterrupted,
      loaded: loaded ?? this.loaded,
    );
  }
}

class SearchKeywordsNotifier extends Notifier<SearchKeywordsState> {
  /// How long typing settles before the box is written to disk. Persisting on
  /// every keystroke would mean a disk write per character on a list somebody
  /// is pasting a hundred lines into.
  static const _saveDebounce = Duration(milliseconds: 600);

  Timer? _saveTimer;

  @override
  SearchKeywordsState build() {
    ref.onDispose(() => _saveTimer?.cancel());
    unawaited(_load());
    return const SearchKeywordsState();
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      state = SearchKeywordsState(
        text: prefs.getString(_textKey) ?? '',
        completed: prefs.getStringList(_completedKey) ?? const [],
        // Still set means the session that set it never reached the code that
        // clears it — it was killed mid-run.
        wasInterrupted: prefs.getBool(_runInFlightKey) ?? false,
        loaded: true,
      ).prune();
    } catch (error, stackTrace) {
      developer.log(
        'Failed to restore the saved keyword list; starting empty.',
        name: 'gratovo.search',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      // Still marked loaded: a preferences read that failed will not start
      // working on retry, and leaving this false would keep the keyword box
      // waiting on a restore that is never coming.
      state = const SearchKeywordsState(loaded: true);
    }
  }

  /// Records what is in the box now. Called from the field's own listener, so
  /// it runs on every text change and must stay cheap — the disk write is
  /// debounced, the state update is not (the count label and the highlight
  /// both read it).
  void setText(String text) {
    if (text == state.text) return;
    state = state.copyWith(text: text).prune();
    _scheduleSave();
  }

  /// Replaces the done-list with what the run has actually finished.
  void setCompleted(List<String> completed) {
    state = state.copyWith(completed: List.unmodifiable(completed)).prune();
    _scheduleSave();
  }

  /// Puts one finished keyword back in the queue.
  ///
  /// The only way back used to be "Start from the top", which throws away the
  /// whole list's progress — so re-running a single keyword whose results
  /// looked wrong meant re-scraping the forty around it. Dropping it from
  /// [SearchKeywordsState.completed] is all it takes: `pending` is derived,
  /// so the keyword un-dims in the box and the next Start picks it up in its
  /// own place in the list.
  void reopenKeyword(String keyword) {
    final target = keyword.trim();
    if (!state.completed.contains(target)) return;
    state = state.copyWith(
      completed: [
        for (final done in state.completed)
          if (done != target) done,
      ],
    );
    _scheduleSave();
  }

  /// Forgets the progress so the next run works the whole list again.
  void clearProgress() {
    if (state.completed.isEmpty) return;
    state = state.copyWith(completed: const []);
    _scheduleSave();
  }

  /// Records that a search process is running right now. Written straight to
  /// disk, not debounced: the whole point is for it to be there before an
  /// unclean exit, which is the one case it is ever read.
  Future<void> markRunStarted() async {
    state = state.copyWith(wasInterrupted: false);
    await _writeRunInFlight(true);
  }

  /// Clears the marker [markRunStarted] set — the run ended deliberately (it
  /// worked its whole list, or Stop was pressed), so there is nothing to
  /// auto-resume next launch. A run that failed on its own does *not* call
  /// this: its unfinished keywords are meant to be picked up next launch.
  Future<void> markRunEnded() async {
    state = state.copyWith(wasInterrupted: false);
    await _writeRunInFlight(false);
  }

  Future<void> _writeRunInFlight(bool value) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_runInFlightKey, value);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to update the search-in-progress marker.',
        name: 'gratovo.search',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  void _scheduleSave() {
    _saveTimer?.cancel();
    _saveTimer = Timer(_saveDebounce, () => unawaited(_persist()));
  }

  Future<void> _persist() async {
    final snapshot = state;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_textKey, snapshot.text);
      await prefs.setStringList(_completedKey, snapshot.completed);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to save the keyword list.',
        name: 'gratovo.search',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

extension on SearchKeywordsState {
  /// Drops done-markers for keywords the box no longer contains.
  ///
  /// Without this, deleting a finished keyword from the box would leave its
  /// marker behind forever — invisible, since there is no line to show it on,
  /// but still counted, so the progress label could read "9/6".
  SearchKeywordsState prune() {
    if (completed.isEmpty) return this;
    final present = keywords.toSet();
    final kept = [
      for (final keyword in completed)
        if (present.contains(keyword)) keyword,
    ];
    if (kept.length == completed.length) return this;
    return copyWith(completed: kept);
  }
}

final searchKeywordsProvider =
    NotifierProvider<SearchKeywordsNotifier, SearchKeywordsState>(
  SearchKeywordsNotifier.new,
);
