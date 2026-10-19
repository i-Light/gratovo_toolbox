import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _prefsKey = 'gratovo.navRailCollapsed';

/// Whether the desktop navigation rail is collapsed to icons only.
///
/// Persisted per device rather than held for the session, unlike the Outreach
/// pane toggles beside it. The difference is what the choice is about: closing
/// a pane is something somebody does to read one thing right now, while
/// collapsing the rail is a standing preference about how much of a small
/// screen the chrome may have — and re-collapsing it at every launch is
/// exactly the kind of small tax that makes an app feel like it is not
/// listening.
///
/// Defaults to expanded (labels showing). At tablet widths the rail is already
/// icons-only regardless of this — see app_shell.dart — because there is not
/// room for labels there at all; this only controls the desktop case, where
/// there is room and somebody may still not want to spend it.
class NavRailCollapsedNotifier extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_loadPersisted());
    return false;
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getBool(_prefsKey);
      if (saved == null) return;
      state = saved;
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load the persisted nav rail state; keeping it expanded.',
        name: 'gratovo.shell',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> toggle() => set(!state);

  // ignore: avoid_positional_boolean_parameters
  Future<void> set(bool collapsed) async {
    state = collapsed;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_prefsKey, collapsed);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist the nav rail state "$collapsed".',
        name: 'gratovo.shell',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final navRailCollapsedProvider =
    NotifierProvider<NavRailCollapsedNotifier, bool>(
  NavRailCollapsedNotifier.new,
);
