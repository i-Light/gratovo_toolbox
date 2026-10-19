import 'dart:async';
import 'dart:developer' as developer;
import 'dart:ui';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _prefsKey = 'gratovo.locale';

/// Persisted UI language. Defaults to Arabic — this app's historical
/// default and the team's working language — with English available via
/// the bilingual toggle in Settings (Phase 4 wires the actual UI control).
/// Loads its persisted value asynchronously; see [ThemeModeNotifier]
/// (core/theme/theme_provider.dart) for why that's an acceptable tradeoff,
/// and for why a read/write failure is logged rather than left to crash
/// the app or fail silently.
class LocaleNotifier extends Notifier<Locale> {
  @override
  Locale build() {
    unawaited(_loadPersisted());
    return const Locale('ar');
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefsKey);
      if (saved == null) return;
      state = Locale(saved);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load persisted locale; keeping default.',
        name: 'gratovo.locale',
        level: 900, // WARNING
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> setLocale(Locale locale) async {
    state = locale;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKey, locale.languageCode);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist locale "$locale".',
        name: 'gratovo.locale',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final localeProvider = NotifierProvider<LocaleNotifier, Locale>(
  LocaleNotifier.new,
);
