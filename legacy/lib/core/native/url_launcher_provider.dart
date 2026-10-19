import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

/// A one-call seam over `url_launcher` so the outreach "open mail app" /
/// "open profile link" paths can be driven in a widget test without a real
/// platform channel.
///
/// The default is the same call the News page makes directly
/// (`launchUrl(uri, mode: LaunchMode.externalApplication)`); returns whether
/// the OS accepted it, so a caller can fall back to copy-to-clipboard on
/// `false`. Tests override this provider with a function that records the
/// `Uri` and returns a canned result.
typedef UrlLauncher = Future<bool> Function(Uri uri);

final urlLauncherProvider = Provider<UrlLauncher>((ref) {
  return (uri) => launchUrl(uri, mode: LaunchMode.externalApplication);
});
