import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The "new since the last fetch" state behind the News page badge.
///
/// [delta] is `story count now - story count as of the previous fetch`. It is
/// recomputed once, each time a fetch finishes, and then held — so the badge
/// keeps reading "+3" until the next fetch rather than flickering back to zero,
/// it survives a restart, and it can go negative if stories aged out. The
/// badge is shown even when [delta] is zero.
class NewsFetchDelta {
  const NewsFetchDelta({required this.delta, required this.lastCount});

  /// The number on the badge.
  final int delta;

  /// Story count recorded at the last fetch — the baseline the next fetch is
  /// measured against.
  final int lastCount;

  static const zero = NewsFetchDelta(delta: 0, lastCount: 0);
}

const _deltaKey = 'gratovo.news.fetchDelta';
const _lastCountKey = 'gratovo.news.lastFetchCount';

class NewsBadgeNotifier extends Notifier<NewsFetchDelta> {
  @override
  NewsFetchDelta build() {
    unawaited(_load());
    return NewsFetchDelta.zero;
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!prefs.containsKey(_lastCountKey)) return;
      state = NewsFetchDelta(
        delta: prefs.getInt(_deltaKey) ?? 0,
        lastCount: prefs.getInt(_lastCountKey) ?? 0,
      );
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load the news badge counters; starting from zero.',
        name: 'gratovo.news',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// Call once a fetch has finished and the fresh stories are stored.
  /// [currentCount] is the total story count now, across every feed.
  Future<void> recordFetch(int currentCount) async {
    final next = NewsFetchDelta(
      delta: currentCount - state.lastCount,
      lastCount: currentCount,
    );
    await _write(next);
  }

  /// Drops the baseline back to zero, so the next fetch reports its full count
  /// as new. Paired with `NewsRepository.clearItems` to test the badge.
  Future<void> reset() => _write(NewsFetchDelta.zero);

  Future<void> _write(NewsFetchDelta next) async {
    state = next;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(_deltaKey, next.delta);
      await prefs.setInt(_lastCountKey, next.lastCount);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist the news badge counters.',
        name: 'gratovo.news',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

/// Reads as [NewsFetchDelta]; the page watches this for the badge label.
final newsBadgeProvider = NotifierProvider<NewsBadgeNotifier, NewsFetchDelta>(
  NewsBadgeNotifier.new,
);
