import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _prefsKey = 'gratovo.influencers.pinnedPosition';

/// The saved scroll offset of the Influencers list — the spot the pin button
/// dropped a marker at, or null when nothing is pinned.
///
/// Persisted, so the marker survives closing the app: someone who pins their
/// place partway down a long vetting list and quits for the day comes back to
/// the same place instead of the top. Loaded right after first read, same
/// load/save/swallow shape as `InfluencerListImagesNotifier` and
/// `DisplayTimeZoneNotifier`.
///
/// The value is an offset in logical pixels measured against the *unfiltered*
/// list, which is the list the app cold-starts showing. Changing search, sort
/// or filters clears it (see `InfluencerListScreen`), because an offset only
/// means anything against the list it was measured on.
class InfluencerPinNotifier extends Notifier<double?> {
  @override
  double? build() {
    unawaited(_load());
    return null;
  }

  Future<void> _load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getDouble(_prefsKey);
      if (saved == null || saved < 0) return;
      state = saved;
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load the influencer-list pin; nothing pinned.',
        name: 'gratovo.influencers',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// Pins [offset] and writes it through, so a later cold start reads it back.
  Future<void> set(double offset) async {
    final value = offset < 0 ? 0.0 : offset;
    state = value;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setDouble(_prefsKey, value);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist the influencer-list pin.',
        name: 'gratovo.influencers',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// Drops the pin, in memory and on disk. A no-op when nothing is pinned, so
  /// it is cheap to call on every filter change.
  Future<void> clear() async {
    if (state == null) return;
    state = null;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_prefsKey);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to clear the influencer-list pin.',
        name: 'gratovo.influencers',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final influencerPinProvider = NotifierProvider<InfluencerPinNotifier, double?>(
  InfluencerPinNotifier.new,
);
