import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';

/// What the Search page's "Generate keywords" dialog is holding: the request
/// in flight, the phrases Gemini answered with, and which of them are ticked.
///
/// [known] is everything the person already has — the keyword box plus the
/// project's all-keywords tally — normalized the way the daemon dedupes
/// (`avoid`: trimmed, case-insensitive). A phrase Gemini returns that is
/// already known is shown greyed and unticked rather than hidden, so the
/// list reads as "here is what came back" and not as a silent shortfall.
class GenerateKeywordsState {
  const GenerateKeywordsState({
    this.generating = false,
    this.result,
    this.error,
    this.known = const {},
    this.selected = const {},
    this.progress,
  });

  final bool generating;

  /// The daemon's last `progress` report for this request — "chat 2 of 4
  /// done" on a multi-chat batch; null for a single chat, which sends none.
  final GeminiProgress? progress;
  final KeywordsResult? result;
  final GeminiBridgeException? error;

  /// Normalized (`trim().toLowerCase()`) phrases already in the list or
  /// already searched.
  final Set<String> known;

  /// The phrases (as Gemini spelled them) that will be added.
  final Set<String> selected;

  List<String> get keywords => result?.keywords ?? const [];

  bool isKnown(String keyword) => known.contains(normalizeKeyword(keyword));

  /// The phrases that can be ticked at all.
  List<String> get addable => [
        for (final keyword in keywords)
          if (!isKnown(keyword)) keyword,
      ];

  /// The ticked phrases, in Gemini's order.
  List<String> get toAdd => [
        for (final keyword in keywords)
          if (selected.contains(keyword)) keyword,
      ];

  GenerateKeywordsState copyWith({
    bool? generating,
    Object? result = _unset,
    Object? error = _unset,
    Set<String>? known,
    Set<String>? selected,
    Object? progress = _unset,
  }) =>
      GenerateKeywordsState(
        generating: generating ?? this.generating,
        progress:
            progress == _unset ? this.progress : progress as GeminiProgress?,
        result: result == _unset ? this.result : result as KeywordsResult?,
        error: error == _unset ? this.error : error as GeminiBridgeException?,
        known: known ?? this.known,
        selected: selected ?? this.selected,
      );

  static String normalizeKeyword(String keyword) =>
      keyword.trim().toLowerCase();
}

const _unset = Object();

/// The dialog's actions: one `action.generate_keywords` call, then ticking.
///
/// `autoDispose`, so closing the dialog forgets the last batch: a stale list
/// of phrases for a different topic reappearing on the next open would read
/// as a fresh answer.
class GenerateKeywordsController extends Notifier<GenerateKeywordsState> {
  StreamSubscription<GeminiEvent>? _progress;

  @override
  GenerateKeywordsState build() {
    ref.onDispose(() => _progress?.cancel());
    return const GenerateKeywordsState();
  }

  GeminiBridge get _bridge => ref.read(geminiBridgeProvider);

  /// Asks Gemini for [count] phrases about [topic], avoiding [avoid] — the
  /// keyword box plus everything already searched, which also becomes
  /// [GenerateKeywordsState.known] for greying. Every phrase that is new is
  /// ticked on arrival: the common case is "add them all", and unticking a
  /// few is less work than ticking ninety.
  ///
  /// [chats] above 1 splits the request across that many separate Gemini
  /// chats (the daemon's batch mode), reporting progress as each one ends.
  /// The keywords gem from Settings is used when one is set.
  Future<void> generate({
    required String topic,
    required int count,
    List<String> exclusions = const [],
    List<String> styles = const [],
    String? language,
    List<String> avoid = const [],
    String? notes,
    int chats = 1,
  }) async {
    final known = {
      for (final keyword in avoid)
        if (keyword.trim().isNotEmpty)
          GenerateKeywordsState.normalizeKeyword(keyword),
    };
    state = state.copyWith(
      generating: true,
      error: null,
      result: null,
      known: known,
      selected: const {},
      progress: null,
    );
    // Saved settings load asynchronously; the first request after start must
    // not go out before the keywords gem has been read.
    await ref.read(geminiBridgeSettingsProvider.notifier).ready;
    final settings = ref.read(geminiBridgeSettingsProvider);
    unawaited(_progress?.cancel());
    _progress = _bridge.events.listen((event) {
      final progress = event.progress;
      if (progress == null || progress.action != 'generate_keywords') return;
      if (!state.generating) return;
      state = state.copyWith(progress: progress);
    });
    try {
      final result = await _bridge.generateKeywords(
        topic: topic.trim(),
        count: count,
        exclusions: exclusions,
        styles: styles,
        language: language,
        avoid: avoid,
        notes: notes,
        gem: settings.keywordsGemOrNull,
        model: settings.defaultModelOrNull,
        chats: chats > 1 ? chats : null,
      );
      final next = state.copyWith(generating: false, result: result);
      state = next.copyWith(selected: next.addable.toSet());
    } on GeminiBridgeException catch (error) {
      state = state.copyWith(generating: false, error: error);
    } finally {
      unawaited(_progress?.cancel());
      _progress = null;
    }
  }

  void toggle(String keyword) {
    if (state.isKnown(keyword)) return;
    final selected = {...state.selected};
    if (!selected.remove(keyword)) selected.add(keyword);
    state = state.copyWith(selected: selected);
  }

  void selectAll() => state = state.copyWith(selected: state.addable.toSet());

  void selectNone() => state = state.copyWith(selected: const {});

  /// Back to the form, keeping nothing of the last answer.
  void reset() => state = const GenerateKeywordsState();
}

final generateKeywordsControllerProvider = NotifierProvider.autoDispose<
    GenerateKeywordsController, GenerateKeywordsState>(
  GenerateKeywordsController.new,
);
