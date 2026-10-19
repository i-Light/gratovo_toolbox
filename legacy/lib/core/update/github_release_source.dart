import 'dart:convert';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:gratovo_toolbox/core/update/app_version.dart';
import 'package:http/http.dart' as http;

/// The repository releases are published to — the same one
/// `.github/workflows/release.yml` publishes to when a `vX.Y.Z` tag is
/// pushed.
const kUpdateRepoSlug = 'i-Light/gratovo_code';

/// One downloadable file attached to a release.
@immutable
class ReleaseAsset {
  const ReleaseAsset({
    required this.name,
    required this.url,
    this.apiUrl,
    this.sizeBytes = 0,
  });

  final String name;

  /// `browser_download_url` — works for a public repo, and is what a person
  /// clicking through the release page would get.
  final String url;

  /// The asset's REST url (`/repos/.../releases/assets/<id>`). On a private
  /// repo this is the only address that serves the bytes: `browser_download_url`
  /// answers 404 to a token-bearing request, while this one answers a 302 to
  /// the real file when asked with `Accept: application/octet-stream`.
  final String? apiUrl;

  final int sizeBytes;

  /// Where to fetch from. The API url when the release carried one, else the
  /// browser url.
  String get downloadUrl => apiUrl ?? url;
}

/// One published release, reduced to what the updater needs.
@immutable
class UpdateRelease {
  const UpdateRelease({
    required this.version,
    required this.tag,
    required this.releasePageUrl,
    this.archive,
    this.installer,
    this.notes = '',
  });

  final AppVersion version;
  final String tag;
  final String releasePageUrl;

  /// The `gratovo_toolbox-<version>-windows-x64.zip`, when the release has
  /// one.
  final ReleaseAsset? archive;

  /// The `gratovo_toolbox-<version>-setup.exe`, when the release has one.
  /// Preferred over [archive] — see [UpdateArtifact.installer].
  final ReleaseAsset? installer;

  final String notes;

  bool get hasInstaller => installer != null;

  /// The asset that would actually be downloaded: the installer when there is
  /// one, the archive otherwise. Null for a release carrying neither, which
  /// `GithubReleaseSource` refuses to build in the first place.
  ReleaseAsset? get preferredAsset => installer ?? archive;

  String get downloadUrl => preferredAsset?.url ?? '';
  String get assetName => preferredAsset?.name ?? '';
  int get sizeBytes => preferredAsset?.sizeBytes ?? 0;
}

/// Asks GitHub what the newest published release is.
///
/// The repository is private, so this call has to be authenticated — an
/// anonymous request gets a 404, because GitHub hides a private repo rather
/// than admitting it exists. The token comes from whoever is signed in on
/// this machine (`GithubAccountController`), never from anything compiled in:
/// a token baked into a desktop binary is readable by anyone who runs
/// `strings` on it, and could not be revoked for one person without
/// rebuilding for everyone.
///
/// A 404 with a token in hand therefore means something specific and worth
/// saying out loud — that account has not been given access to the repository
/// — which is what the Accounts card reports.
class GithubReleaseSource {
  const GithubReleaseSource({
    http.Client? client,
    this.repoSlug = kUpdateRepoSlug,
    this.token,
  }) : _client = client;

  final http.Client? _client;
  final String repoSlug;

  /// The signed-in person's own GitHub token. Null means nobody has signed in
  /// here yet, in which case this will find nothing — correctly.
  final String? token;

  /// The newest release, or null when there isn't one, the repo isn't
  /// reachable or visible, or the payload doesn't carry a usable artifact.
  Future<UpdateRelease?> fetchLatest() async {
    final client = _client ?? http.Client();
    try {
      final response = await client.get(
        Uri.https('api.github.com', '/repos/$repoSlug/releases/latest'),
        headers: {
          'Accept': 'application/vnd.github+json',
          // GitHub rejects API calls with no User-Agent outright.
          'User-Agent': 'gratovo-toolbox-updater',
          'X-GitHub-Api-Version': '2022-11-28',
          if (token != null) 'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 20));

      if (response.statusCode != 200) {
        developer.log(
          'Update check got HTTP ${response.statusCode} from GitHub; '
          'treating as "no update available". A 404 means this account cannot '
          'see the repository (or nobody is signed in); a 401 means the stored '
          'token has been revoked. Settings -> Accounts reports both.',
          name: 'gratovo.update',
          level: 800,
        );
        return null;
      }
      return _parse(
        jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>,
      );
    } catch (error, stackTrace) {
      // Offline, DNS failure, timeout, malformed JSON — an update check is
      // best-effort by nature and must never surface as an error to someone
      // who was just trying to use the app.
      developer.log(
        'Update check failed; will try again on the next poll.',
        name: 'gratovo.update',
        level: 800,
        error: error,
        stackTrace: stackTrace,
      );
      return null;
    } finally {
      if (_client == null) client.close();
    }
  }

  @visibleForTesting
  static UpdateRelease? parse(Map<String, dynamic> json) => _parse(json);

  static UpdateRelease? _parse(Map<String, dynamic> json) {
    if (json['draft'] == true || json['prerelease'] == true) return null;
    final tag = json['tag_name'] as String?;
    final version = AppVersion.tryParse(tag);
    if (version == null) return null;

    // Matched by suffix rather than by exact name: the names carry the
    // version, so matching them literally would mean rebuilding the expected
    // string here every release and silently finding nothing the first time
    // the staging name changes.
    final assets = (json['assets'] as List<dynamic>? ?? const [])
        .cast<Map<String, dynamic>>();
    final archive = _assetMatching(assets, (name) => name.endsWith('.zip'));
    final installer = _assetMatching(
      assets,
      (name) => name.endsWith('setup.exe') || name.endsWith('-setup.exe'),
    );
    // A release with neither is not something this can install. It happens —
    // a tag pushed by hand, or a workflow run that failed after creating the
    // release — and it must read as "nothing to update to" rather than as an
    // update that then fails to download.
    if (archive == null && installer == null) return null;

    return UpdateRelease(
      version: version,
      tag: tag!,
      archive: archive,
      installer: installer,
      releasePageUrl: json['html_url'] as String? ??
          'https://github.com/$kUpdateRepoSlug/releases',
      notes: json['body'] as String? ?? '',
    );
  }

  static ReleaseAsset? _assetMatching(
    List<Map<String, dynamic>> assets,
    bool Function(String lowercaseName) matches,
  ) {
    for (final asset in assets) {
      final name = asset['name'] as String? ?? '';
      final url = asset['browser_download_url'] as String?;
      if (url != null && matches(name.toLowerCase())) {
        return ReleaseAsset(
          name: name,
          url: url,
          apiUrl: asset['url'] as String?,
          sizeBytes: asset['size'] as int? ?? 0,
        );
      }
    }
    return null;
  }
}
