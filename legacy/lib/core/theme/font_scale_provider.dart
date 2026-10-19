import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _prefsKey = 'gratovo.fontScale';

/// Hard limits. Below 0.8 the dense influencer list stops being readable;
/// above 1.6 the search settings row wraps into an unusable column even on a
/// wide desktop window. Anything the user picks is clamped into this range on
/// both read and write, so a corrupted preference can never render the app
/// unusable — which would otherwise be unrecoverable, since the Settings
/// control needed to fix it would itself be off-screen.
const double kMinFontScale = 0.8;
const double kMaxFontScale = 1.6;
const double kDefaultFontScale = 1.1;

/// App-wide font size multiplier, persisted per device.
///
/// Applied once, at the root, by wrapping the app in a `MediaQuery` whose
/// `textScaler` is this value (see app.dart) rather than by multiplying font
/// sizes inside the theme. That matters: `textScaler` is the mechanism Flutter
/// itself uses for accessibility text scaling, so it reaches every widget
/// including ones that never read our `TextTheme` — icons-with-labels,
/// tooltips, dropdown menu items, snackbars. Scaling the theme's font sizes
/// would miss all of those and leave the UI visually inconsistent.
///
/// The device's own accessibility text-size setting is deliberately replaced
/// rather than multiplied with: this is an internal tool used on shared
/// machines, and compounding a 1.3 system scale with a 1.4 app scale produced
/// a 1.8x layout nobody asked for.
class FontScaleNotifier extends Notifier<double> {
  @override
  double build() {
    unawaited(_loadPersisted());
    return kDefaultFontScale;
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getDouble(_prefsKey);
      if (saved == null) return;
      state = clampScale(saved);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load persisted font scale; keeping default.',
        name: 'gratovo.theme',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> setScale(double scale) async {
    final clamped = clampScale(scale);
    state = clamped;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setDouble(_prefsKey, clamped);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist font scale "$clamped".',
        name: 'gratovo.theme',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> reset() => setScale(kDefaultFontScale);
}

/// Clamps into the supported range, and maps NaN/infinity back to the default
/// rather than propagating a value that would make every layout throw.
double clampScale(double scale) {
  if (scale.isNaN || scale.isInfinite) return kDefaultFontScale;
  return scale.clamp(kMinFontScale, kMaxFontScale);
}

final fontScaleProvider = NotifierProvider<FontScaleNotifier, double>(
  FontScaleNotifier.new,
);
