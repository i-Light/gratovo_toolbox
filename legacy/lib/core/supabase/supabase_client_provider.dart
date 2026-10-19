import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// The result of trying to bring Supabase up at launch.
///
/// `Supabase.initialize()` can only be called once per process and must
/// happen before the widget tree exists, so it runs in `main()` and the
/// outcome is injected here as a provider override. Nothing in the app
/// reaches for `Supabase.instance` directly — a screen that did would throw
/// on any build where initialisation failed, instead of degrading.
class SupabaseBoot {
  const SupabaseBoot({required this.config, this.client, this.error});

  final SupabaseConfig config;

  /// Null when the config was blank or initialisation threw.
  final SupabaseClient? client;

  /// Why initialisation failed, for the Account card to show. Kept rather
  /// than logged-and-dropped: "signed out" and "the server address is wrong"
  /// look identical to a user otherwise, and they need very different fixes.
  final Object? error;

  bool get isReady => client != null;
}

final supabaseBootProvider = Provider<SupabaseBoot>((ref) {
  throw StateError(
    'supabaseBootProvider must be overridden in main() — see lib/main.dart.',
  );
});

/// The client every repository is built from, or null when the backend is
/// unreachable/unconfigured. Repositories that get null fall back to the
/// in-memory mocks, so the app still opens and shows its shape.
final supabaseClientProvider = Provider<SupabaseClient?>((ref) {
  return ref.watch(supabaseBootProvider).client;
});

/// Fires on every sign-in, sign-out, and silent token refresh.
final authStateChangesProvider = StreamProvider<AuthState>((ref) {
  final client = ref.watch(supabaseClientProvider);
  if (client == null) return const Stream<AuthState>.empty();
  return client.auth.onAuthStateChange;
});

/// The current session, or null when signed out.
///
/// Reads `currentSession` rather than the stream's payload so it is correct
/// on the very first frame — the stream has not emitted yet at that point,
/// but a restored session from a previous launch is already loaded.
final currentSessionProvider = Provider<Session?>((ref) {
  final client = ref.watch(supabaseClientProvider);
  ref.watch(authStateChangesProvider);
  return client?.auth.currentSession;
});

final isSignedInProvider = Provider<bool>((ref) {
  return ref.watch(currentSessionProvider) != null;
});

/// The signed-in person's own profile row: display name, color, access level.
final currentProfileProvider = FutureProvider<TeamMember?>((ref) async {
  final client = ref.watch(supabaseClientProvider);
  final session = ref.watch(currentSessionProvider);
  if (client == null || session == null) return null;

  final row = await client
      .from('profiles')
      .select()
      .eq('id', session.user.id)
      .maybeSingle();
  return row == null ? null : TeamMember.fromRow(row);
});

/// This session's access level, defaulting to the most restrictive value.
///
/// The default matters: while the profile is still loading, or if the lookup
/// fails, the app must behave as though the person has NO access rather than
/// optimistically showing controls it would then have to snatch back. The
/// server would refuse the data anyway; this just keeps the UI honest.
final accessLevelProvider = Provider<AccessLevel>((ref) {
  return ref.watch(currentProfileProvider).maybeWhen(
        data: (profile) => profile?.accessLevel ?? AccessLevel.unauthorized,
        orElse: () => AccessLevel.unauthorized,
      );
});

/// Everyone on the team, keyed by account id — the lookup table that turns a
/// presence payload's bare user id into a name and a color to draw with.
final teamMembersProvider =
    FutureProvider<Map<String, TeamMember>>((ref) async {
  final client = ref.watch(supabaseClientProvider);
  final session = ref.watch(currentSessionProvider);
  if (client == null || session == null) return const {};

  final rows = await client.from('profiles').select();
  return {
    for (final row in rows) row['id'] as String: TeamMember.fromRow(row),
  };
});
