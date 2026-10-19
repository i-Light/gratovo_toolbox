import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:http/http.dart' as http;

/// Why a release could not be read — each one needs a different fix, so the
/// card says which.
enum MyAppReleaseProblem {
  /// 404: the repository has no published release, or (for a private one)
  /// the token here cannot see it. GitHub does not say which.
  notVisible,

  /// 401: the token was revoked or expired.
  tokenRejected,

  /// Offline, GitHub down, a timeout.
  unreachable,
}

/// The newest release of one of the owner's apps, reduced to the files the
/// My apps card can do something with.
@immutable
class MyAppRelease {
  const MyAppRelease({
    required this.tag,
    required this.pageUrl,
    this.windowsInstaller,
    this.apk,
  });

  final String tag;
  final String pageUrl;

  /// The asset whose name ends in `setup.exe` — the same convention
  /// Gratovo's own releases use.
  final ReleaseAsset? windowsInstaller;

  /// The asset whose name ends in `.apk`.
  final ReleaseAsset? apk;

  @visibleForTesting
  static MyAppRelease parse(Map<String, dynamic> json, String repo) {
    ReleaseAsset? find(bool Function(String name) test) {
      for (final raw in (json['assets'] as List<dynamic>? ?? const [])
          .cast<Map<String, dynamic>>()) {
        final name = raw['name'] as String? ?? '';
        final url = raw['browser_download_url'] as String?;
        if (url != null && test(name.toLowerCase())) {
          return ReleaseAsset(
            name: name,
            url: url,
            apiUrl: raw['url'] as String?,
            sizeBytes: raw['size'] as int? ?? 0,
          );
        }
      }
      return null;
    }

    return MyAppRelease(
      tag: json['tag_name'] as String? ?? '',
      pageUrl: json['html_url'] as String? ??
          'https://github.com/$repo/releases/latest',
      windowsInstaller: find((n) => n.endsWith('setup.exe')),
      apk: find((n) => n.endsWith('.apk')),
    );
  }
}

typedef MyAppReleaseResult = ({
  MyAppRelease? release,
  MyAppReleaseProblem? problem,
});

/// Reads `releases/latest` of any repository.
///
/// Not [GithubReleaseSource]: that one is built around this app's own
/// version scheme and refuses a release without a Windows build, while an
/// app here may ship only an `.apk`.
class MyAppReleases {
  const MyAppReleases({http.Client? client}) : _client = client;

  final http.Client? _client;

  Future<MyAppReleaseResult> latest(String repo, {String? token}) async {
    final client = _client ?? http.Client();
    try {
      final response = await client.get(
        Uri.https('api.github.com', '/repos/$repo/releases/latest'),
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'gratovo-toolbox-my-apps',
          'X-GitHub-Api-Version': '2022-11-28',
          if (token != null && token.isNotEmpty)
            'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 20));
      return switch (response.statusCode) {
        200 => (
            release: MyAppRelease.parse(
              jsonDecode(utf8.decode(response.bodyBytes))
                  as Map<String, dynamic>,
              repo,
            ),
            problem: null,
          ),
        401 => (release: null, problem: MyAppReleaseProblem.tokenRejected),
        404 => (release: null, problem: MyAppReleaseProblem.notVisible),
        _ => (release: null, problem: MyAppReleaseProblem.unreachable),
      };
    } catch (error, stackTrace) {
      developer.log(
        'Could not read the latest release of $repo.',
        name: 'gratovo.my_apps',
        level: 800,
        error: error,
        stackTrace: stackTrace,
      );
      return (release: null, problem: MyAppReleaseProblem.unreachable);
    } finally {
      if (_client == null) client.close();
    }
  }
}
