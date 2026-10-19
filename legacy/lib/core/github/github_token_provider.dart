import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/github/github_auth.dart';
import 'package:gratovo_toolbox/core/github/shared_release_token.dart';

/// Which token the update check ends up using.
enum GithubTokenSource {
  /// The shared, compiled-in token every copy of the app carries.
  shared,

  /// A token belonging to whoever signed in on this machine. Overrides
  /// [shared] when present.
  personal,

  /// Neither — the build has no shared token and nobody has signed in.
  none,
}

/// The token the update check should send, and where it came from.
///
/// Personal beats shared, deliberately. The shared token is the floor that
/// makes updates work out of the box for everyone; a personal sign-in is the
/// escape hatch for the one failure this design has — the shared token
/// expiring or being revoked stops updates for the whole team at once, and
/// somebody who needs an update before the next build can sign in as
/// themselves instead of waiting.
///
/// Lives in core/ rather than beside the Accounts card, because
/// `UpdateController` needs it and a core service reaching into a feature for
/// a provider is the wrong direction. The card invalidates this after a
/// sign-in or sign-out, so the next check uses the new token without waiting
/// for a restart.
final githubTokenProvider =
    FutureProvider<({String? token, GithubTokenSource source})>(
  (ref) async {
    final personal = await GithubAuth().readToken();
    if (personal != null) {
      return (token: personal, source: GithubTokenSource.personal);
    }
    final shared = sharedReleaseToken;
    if (shared != null) {
      return (token: shared, source: GithubTokenSource.shared);
    }
    return (token: null, source: GithubTokenSource.none);
  },
);
