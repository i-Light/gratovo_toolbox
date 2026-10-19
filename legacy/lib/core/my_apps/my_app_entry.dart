import 'dart:convert';

import 'package:flutter/foundation.dart';

/// One of the owner's other apps, as listed in `assets/my_apps.json`.
///
/// Every section is optional on purpose: an app can be a Windows program
/// with no repository, a Google Play listing and nothing else, or all of it.
/// The Settings -> My apps card offers only what an entry actually says, so
/// adding an app is a matter of writing down what is true about it and
/// nothing more. `docs/MY_APPS.md` is the how-to.
@immutable
class MyAppEntry {
  const MyAppEntry({
    required this.id,
    required this.name,
    this.description = const {},
    this.icon = 'apps',
    this.github,
    this.windows,
    this.android,
  });

  final String id;

  /// Per language code; `''` holds a name written once for every language.
  final Map<String, String> name;

  final Map<String, String> description;

  /// A name from [myAppIconNames]; anything else falls back to `apps`.
  final String icon;

  final MyAppGithub? github;
  final MyAppWindows? windows;
  final MyAppAndroid? android;

  String nameFor(String languageCode) => _pick(name, languageCode) ?? id;

  String? descriptionFor(String languageCode) =>
      _pick(description, languageCode);

  /// The language asked for, then English, then whatever there is — a
  /// description written only in Arabic still beats a blank row.
  static String? _pick(Map<String, String> values, String languageCode) =>
      values[languageCode] ??
      values[''] ??
      values['en'] ??
      (values.isEmpty ? null : values.values.first);
}

@immutable
class MyAppGithub {
  const MyAppGithub({required this.repo, this.isPrivate = false});

  /// `owner/name`.
  final String repo;

  /// A private repository is only reachable with a token that has been
  /// given access to it — the one from Settings -> Accounts -> GitHub.
  final bool isPrivate;

  Uri get pageUrl => Uri.https('github.com', '/$repo');
  Uri get releasesUrl => Uri.https('github.com', '/$repo/releases/latest');
}

@immutable
class MyAppWindows {
  const MyAppWindows({this.exe = const []});

  /// Where the program may be installed, first match wins. `%VAR%` is
  /// expanded from the environment, so `%LOCALAPPDATA%/Programs/...` works
  /// for every user of the machine. Forward slashes are fine (and easier to
  /// write in JSON than doubled backslashes).
  final List<String> exe;
}

@immutable
class MyAppAndroid {
  const MyAppAndroid({
    required this.package,
    this.playStore = false,
    this.apk = false,
  });

  /// The application id, e.g. `com.gratovo.dhikr_reminder`.
  final String package;

  /// Listed on Google Play.
  final bool playStore;

  /// The latest GitHub release carries an `.apk` to install directly.
  final bool apk;

  Uri get playStoreUrl => Uri.https(
        'play.google.com',
        '/store/apps/details',
        {'id': package},
      );
}

/// The icon names an entry may use.
const myAppIconNames = {
  'apps',
  'mosque',
  'book',
  'calendar',
  'chat',
  'music',
  'game',
  'tools',
  'school',
  'heart',
  'alarm',
  'notifications',
};

/// What reading the registry produced: the apps it could use, and a line per
/// entry it could not — shown in the card rather than dropped, so a typo in
/// the JSON does not make an app vanish without a word.
@immutable
class MyAppsRegistry {
  const MyAppsRegistry({this.apps = const [], this.problems = const []});

  final List<MyAppEntry> apps;
  final List<String> problems;

  static MyAppsRegistry parse(String source) {
    final Object? root;
    try {
      root = jsonDecode(source);
    } on FormatException catch (error) {
      return MyAppsRegistry(problems: ['my_apps.json: ${error.message}']);
    }
    if (root is! Map || root['apps'] is! List) {
      return const MyAppsRegistry(
        problems: ['my_apps.json: expected {"apps": [...]}'],
      );
    }

    final apps = <MyAppEntry>[];
    final problems = <String>[];
    final seen = <String>{};
    final list = root['apps'] as List;
    for (var i = 0; i < list.length; i++) {
      try {
        final app = _app(list[i]);
        if (!seen.add(app.id)) {
          throw FormatException('duplicate id "${app.id}"');
        }
        apps.add(app);
      } on FormatException catch (error) {
        problems.add('apps[$i]: ${error.message}');
      }
    }
    return MyAppsRegistry(apps: apps, problems: problems);
  }

  static MyAppEntry _app(Object? raw) {
    if (raw is! Map) throw const FormatException('not an object');
    final id = _string(raw, 'id');
    final icon = raw['icon'] is String ? raw['icon'] as String : 'apps';
    return MyAppEntry(
      id: id,
      name: _localized(raw['name'], 'name') ?? {'': id},
      description: _localized(raw['description'], 'description') ?? const {},
      icon: myAppIconNames.contains(icon) ? icon : 'apps',
      github: _section(raw, 'github', (m) {
        final repo = _string(m, 'repo', where: 'github');
        if (!RegExp(r'^[\w.-]+/[\w.-]+$').hasMatch(repo)) {
          throw FormatException('github.repo "$repo" is not owner/name');
        }
        return MyAppGithub(repo: repo, isPrivate: m['private'] == true);
      }),
      windows: _section(raw, 'windows', (m) {
        final exe = m['exe'];
        final paths = switch (exe) {
          final String one => [one],
          final List<dynamic> many => many.whereType<String>().toList(),
          _ => const <String>[],
        };
        return MyAppWindows(
            exe: paths.where((p) => p.trim().isNotEmpty).toList());
      }),
      android: _section(raw, 'android', (m) {
        return MyAppAndroid(
          package: _string(m, 'package', where: 'android'),
          playStore: m['playStore'] == true,
          apk: m['apk'] == true,
        );
      }),
    );
  }

  static T? _section<T>(Map raw, String key, T Function(Map m) build) {
    final value = raw[key];
    if (value == null) return null;
    if (value is! Map) throw FormatException('$key is not an object');
    return build(value);
  }

  static String _string(Map raw, String key, {String? where}) {
    final value = raw[key];
    if (value is String && value.trim().isNotEmpty) return value.trim();
    throw FormatException('${where == null ? '' : '$where.'}$key is missing');
  }

  /// A plain string (every language) or `{"en": ..., "ar": ...}`.
  static Map<String, String>? _localized(Object? raw, String key) {
    if (raw == null) return null;
    if (raw is String) return {'': raw};
    if (raw is Map) {
      return {
        for (final entry in raw.entries)
          if (entry.value is String) '${entry.key}': entry.value as String,
      };
    }
    throw FormatException('$key must be text or {"en": ..., "ar": ...}');
  }
}

/// `%NAME%` replaced from [env], matched without regard to case as Windows
/// does. An unknown variable is left as written, so the path simply does not
/// exist rather than silently pointing somewhere else.
String expandWindowsEnv(String path, Map<String, String> env) {
  final upper = {for (final e in env.entries) e.key.toUpperCase(): e.value};
  return path.replaceAllMapped(
    RegExp('%([^%]+)%'),
    (m) => upper[m[1]!.toUpperCase()] ?? m[0]!,
  );
}
