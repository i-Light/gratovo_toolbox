import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _completedPrefsKey = 'gratovo.onboarding.completed';

/// Whether the first-launch onboarding wizard has already run on this
/// machine. Same load/save/swallow shape as `AutoDownloadImagesNotifier`
/// (`core/images/image_preferences.dart`): a `Notifier<bool>`, one
/// `shared_preferences` key, and a default that keeps the app usable if the
/// read or write fails.
///
/// The default is `false` (not yet completed) rather than `true`: this is a
/// "have we positively recorded that this ran" flag, so anything short of a
/// confirmed `true` in prefs — nothing stored yet, or a failed read — means
/// the wizard has not been shown, and the honest answer is to show it. That
/// matches "shows once": it stays visible until it is actually dismissed, it
/// never silently disappears because a preference happened not to load.
class OnboardingCompletionNotifier extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_loadPersisted());
    return false;
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getBool(_completedPrefsKey);
      if (saved == null) return;
      state = saved;
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load the onboarding-completed preference; keeping the '
        'wizard available.',
        name: 'gratovo.onboarding',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// Marks the wizard done so it never shows again on this machine — whether
  /// every step actually resolved or the person skipped straight through.
  Future<void> markComplete() async {
    state = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_completedPrefsKey, true);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist that onboarding finished; it may show again next '
        'launch.',
        name: 'gratovo.onboarding',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final onboardingCompletedProvider =
    NotifierProvider<OnboardingCompletionNotifier, bool>(
  OnboardingCompletionNotifier.new,
);

/// What `OnboardingGate` checks: the plain negation of
/// [onboardingCompletedProvider], named for what the caller actually wants to
/// know. Kept as its own provider so a caller outside this feature (the app
/// shell) reads one boolean rather than reaching past this feature's own
/// "completed" bookkeeping.
final needsOnboardingProvider = Provider<bool>((ref) {
  return !ref.watch(onboardingCompletedProvider);
});
