import 'dart:io';

/// The value of [name] in this machine's environment, or null when unset.
///
/// A fallback for exactly one situation: running the app from source. The
/// real values arrive through `--dart-define`, which a plain `flutter run`
/// (or F5 in an editor) does not pass — so without this, updates would work
/// in the shipped build and silently not in development, which is the most
/// confusing way round for it to break.
///
/// Shipped builds never rely on this: a teammate's machine has no such
/// variable, which is why `scripts/build_windows.ps1` bakes the values in at
/// build time.
String? githubEnvValue(String name) {
  final value = Platform.environment[name]?.trim();
  return (value == null || value.isEmpty) ? null : value;
}
