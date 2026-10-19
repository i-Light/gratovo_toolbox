import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/utils/blank.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Where this build points, and the public key it presents.
///
/// NEITHER of these values is a secret, and that is the whole reason this
/// file can exist in the repository at all:
///
/// * The **URL** is a public address.
/// * The **anon key** is designed to be shipped inside client applications —
///   it is embedded in every Supabase web app on the internet. On its own it
///   grants nothing: row level security decides what each *signed-in* person
///   may read, and an anonymous caller holding this key gets zero rows from
///   every table (verified — see backend/SETUP.md).
///
/// The key that must never appear here is the **service_role** key, which
/// bypasses row level security entirely. It lives only in `backend/.env` on
/// the machine that runs the importer.
///
/// Per-person credentials (email + password) are NOT config. They belong to
/// the individual, are entered at the login screen, and are held by Supabase
/// Auth as a refreshing session token — never written to a file.
class SupabaseConfig {
  const SupabaseConfig({required this.url, required this.anonKey});

  final String url;
  final String anonKey;

  /// Enough to attempt a connection. Says nothing about whether the values
  /// are *correct* — only a real request can establish that.
  bool get isConfigured => url.trim().isNotEmpty && anonKey.trim().isNotEmpty;

  SupabaseConfig copyWith({String? url, String? anonKey}) => SupabaseConfig(
        url: url ?? this.url,
        anonKey: anonKey ?? this.anonKey,
      );

  /// The same pair with surrounding whitespace removed — what a text field's
  /// content means once someone has pasted it in with a stray space or newline.
  SupabaseConfig get trimmed =>
      SupabaseConfig(url: url.trim(), anonKey: anonKey.trim());

  /// The key for showing on screen without spelling it out: enough of both
  /// ends to tell two keys apart, nothing that could be pasted elsewhere.
  ///
  /// The anon key is public by design (see above), so this is about not
  /// printing a 200-character token into a settings page, not about secrecy.
  /// Short values are hidden completely rather than half-shown.
  String get maskedAnonKey {
    final key = anonKey.trim();
    if (key.isEmpty) return '';
    if (key.length <= 12) return '••••';
    return '${key.substring(0, 4)}…${key.substring(key.length - 4)}';
  }

  @override
  bool operator ==(Object other) =>
      other is SupabaseConfig && other.url == url && other.anonKey == anonKey;

  @override
  int get hashCode => Object.hash(url, anonKey);
}

/// What the compiler was handed for one setting: [defined] is the raw
/// `String.fromEnvironment` value, [fallback] the team's project.
///
/// `String.fromEnvironment(name, defaultValue: x)` only falls back to `x` when
/// the name is ABSENT — a name defined as an empty string comes back empty.
/// That is not hypothetical here: the tracked `data/.env` carries a blank
/// `SUPABASE_URL=` (the pipeline's one-time export tool reads the real one
/// from `.env.local`), `scripts/build_windows.ps1` and `.vscode/launch.json`
/// both hand that whole file to `--dart-define-from-file`, and every build made
/// that way compiled an EMPTY server address into the app. Reset to defaults
/// then "restored" a blank field. A blank define is treated as no define.
String compiledOrFallback(String defined, String fallback) {
  final value = defined.trim();
  return value.isEmpty ? fallback : value;
}

const String _envSupabaseUrl = String.fromEnvironment('SUPABASE_URL');
const String _envSupabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

/// The team's project, used when the build was not told about another one.
const String _teamProjectUrl = '<redacted: set SUPABASE_URL at build time>';
const String _teamProjectAnonKey = '<redacted: set SUPABASE_ANON_KEY at build time>';

/// Compiled-in defaults for the team's project.
///
/// Overridable at build time without editing this file:
///
///     flutter run --dart-define=SUPABASE_URL=https://other.supabase.co \
///                 --dart-define=SUPABASE_ANON_KEY=eyJ...
///
/// and overridable at RUNTIME from Settings → Account → Advanced, which is
/// what makes moving to a different Supabase project a settings change
/// rather than a rebuild-and-redistribute.
final String kCompiledSupabaseUrl =
    compiledOrFallback(_envSupabaseUrl, _teamProjectUrl);

final String kCompiledSupabaseAnonKey =
    compiledOrFallback(_envSupabaseAnonKey, _teamProjectAnonKey);

/// The pair this build shipped with — what "Reset to defaults" goes back to.
///
/// A provider because the values themselves are fixed at compile time, which
/// leaves a widget test no way to be a build that shipped something else (or
/// nothing at all); it overrides this instead.
final shippedSupabaseConfigProvider = Provider<SupabaseConfig>(
  (ref) => SupabaseConfig(
    url: kCompiledSupabaseUrl,
    anonKey: kCompiledSupabaseAnonKey,
  ),
);

const _urlKey = 'gratovo.supabase.url';
const _anonKey = 'gratovo.supabase.anonKey';

/// Reads/writes the optional per-device override of the compiled-in values.
///
/// `shared_preferences`, not `flutter_secure_storage`, on purpose: these are
/// public values, and putting non-secrets in the keychain trains people to
/// assume anything in there is equally unimportant. The AI API keys in
/// `secure_ai_provider_config_repository.dart` are the things that genuinely
/// need the keychain.
///
/// An override is stored per field and only where it DIFFERS from [shipped].
/// Saving the shipped values is the same as saving nothing: a copy of today's
/// default written to disk would outlive the update that changes the default
/// and quietly pin this machine to the old project.
class SupabaseConfigStore {
  const SupabaseConfigStore({this.shipped});

  /// What "no override" means. Null is this build's own compiled-in pair; a
  /// test passes a different one.
  final SupabaseConfig? shipped;

  SupabaseConfig get _shipped =>
      shipped ??
      SupabaseConfig(
          url: kCompiledSupabaseUrl, anonKey: kCompiledSupabaseAnonKey);

  /// The stored override if there is one, otherwise the compiled-in values.
  /// Never throws — a preferences failure falls back to the compiled values
  /// rather than leaving the app with no backend at all.
  Future<SupabaseConfig> read() async {
    final shipped = _shipped;
    try {
      final prefs = await SharedPreferences.getInstance();
      return SupabaseConfig(
        url: prefs.getString(_urlKey).trimmedOrNull ?? shipped.url,
        anonKey: prefs.getString(_anonKey).trimmedOrNull ?? shipped.anonKey,
      );
    } catch (error, stackTrace) {
      developer.log(
        'Could not read the stored Supabase override; using compiled-in values.',
        name: 'gratovo.supabase.config',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      return shipped;
    }
  }

  /// Whether this device holds any value of its own, whether or not it
  /// happens to equal what shipped. False when the preferences cannot be read:
  /// there is nothing this can honestly claim to be clearing.
  Future<bool> hasOverride() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(_urlKey).trimmedOrNull != null ||
          prefs.getString(_anonKey).trimmedOrNull != null;
    } catch (error, stackTrace) {
      developer.log(
        'Could not read the stored Supabase override.',
        name: 'gratovo.supabase.config',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  /// Stores what [config] changes relative to the shipped pair, and removes
  /// whatever it no longer changes.
  Future<void> write(SupabaseConfig config) async {
    final shipped = _shipped.trimmed;
    final wanted = config.trimmed;
    final prefs = await SharedPreferences.getInstance();
    await _apply(prefs, _urlKey, wanted.url, shipped.url);
    await _apply(prefs, _anonKey, wanted.anonKey, shipped.anonKey);
  }

  static Future<void> _apply(
    SharedPreferences prefs,
    String key,
    String wanted,
    String shipped,
  ) async {
    if (wanted.isEmpty || wanted == shipped) {
      await prefs.remove(key);
    } else {
      await prefs.setString(key, wanted);
    }
  }

  /// Drops the override so the compiled-in values take effect again.
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_urlKey);
    await prefs.remove(_anonKey);
  }
}
