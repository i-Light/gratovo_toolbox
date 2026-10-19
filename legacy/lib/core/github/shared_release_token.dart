import 'package:gratovo_toolbox/core/github/github_env.dart';

/// One GitHub token, compiled into the build, that every copy of the app uses
/// to read the private repository's releases.
///
/// ## What this is, and what it costs
///
/// This is a shared credential shipped inside a binary. It is readable by
/// anyone who has the `.exe` — `strings gratovo_toolbox.exe` finds it in about
/// a second, and no amount of encoding changes that, because whatever the
/// program can decode at runtime a person can decode too. It is not secret and
/// must not be treated as though it were.
///
/// It is used anyway because the alternative costs more than it is worth here:
/// the repository is private, the audience is one small team, and the thing
/// the token can reach is a folder of release zips they are all entitled to.
/// The trade is deliberate, not an oversight.
///
/// ## What keeps the trade small
///
/// Three things, and they are the reason this is acceptable rather than
/// merely convenient:
///
/// 1. **The token is fine-grained and read-only, scoped to this repository
///    alone.** Not a classic PAT — a classic `repo` token would carry write
///    access to every repository its owner can touch, and handing that to
///    everyone with the .exe would be a genuinely bad idea. A fine-grained
///    token with `Contents: Read-only` on `i-Light/gratovo_code` can do
///    exactly one thing: list and download releases of this project.
/// 2. **It belongs to a machine account, not to a person.** Revoking it, or
///    letting it expire, touches nothing anybody uses day to day.
/// 3. **It expires.** GitHub requires an expiry on fine-grained tokens, and
///    that is a feature here: a leaked token stops working on its own. The
///    cost is that updates stop when it lapses, which is why
///    `settingsAttentionProvider` badges a rejected token rather than letting
///    the app go quietly stale.
///
/// A token found by GitHub's secret scanning is revoked automatically, so if
/// this .exe is ever uploaded somewhere GitHub can see, updates will stop
/// working. That is the scanner doing its job.
///
/// ## Replacing it
///
/// Rebuild with a new `--dart-define=GRATOVO_GITHUB_TOKEN=...` and ship. There
/// is no per-person revocation: retiring the token retires it for everybody,
/// which is the main thing given up by choosing one shared credential over a
/// sign-in per person.
const _compiledSharedReleaseToken =
    String.fromEnvironment('GRATOVO_GITHUB_TOKEN', defaultValue: '');

/// The shared token this build will use, or null when it was built without
/// one.
///
/// Falls back to a `GRATOVO_GITHUB_TOKEN` environment variable so a run from
/// source behaves like the shipped build — see [githubEnvValue].
String? get sharedReleaseToken {
  if (_compiledSharedReleaseToken.isNotEmpty) {
    return _compiledSharedReleaseToken;
  }
  return githubEnvValue('GRATOVO_GITHUB_TOKEN');
}

bool get hasSharedReleaseToken => sharedReleaseToken != null;
