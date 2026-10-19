import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _prefsKey = 'gratovo.themeMode';

/// Persisted app-wide theme mode (light/dark/system). Defaults to dark,
/// matching the single fixed dark theme this app shipped with before the
/// Settings toggle existed (Phase 4 wires the actual UI control). Reads its
/// persisted value asynchronously right after this provider is first read,
/// so the very first frame may briefly show the default before settling —
/// acceptable for a preference this low-stakes. A failure to read or write
/// the persisted value (rare, but `shared_preferences` can throw on some
/// platform channel hiccups) is logged and otherwise swallowed rather than
/// crashing the app over a cosmetic preference.
class ThemeModeNotifier extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    unawaited(_loadPersisted());
    return ThemeMode.dark;
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefsKey);
      if (saved == null) return;
      state = ThemeMode.values.firstWhere(
        (mode) => mode.name == saved,
        orElse: () => ThemeMode.dark,
      );
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load persisted theme mode; keeping default.',
        name: 'gratovo.theme',
        level: 900, // WARNING
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    state = mode;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKey, mode.name);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist theme mode "$mode".',
        name: 'gratovo.theme',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final themeModeProvider = NotifierProvider<ThemeModeNotifier, ThemeMode>(
  ThemeModeNotifier.new,
);
