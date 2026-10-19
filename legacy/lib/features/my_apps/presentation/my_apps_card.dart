import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/github/github_token_provider.dart';
import 'package:gratovo_toolbox/core/my_apps/my_app_entry.dart';
import 'package:gratovo_toolbox/core/my_apps/my_app_releases.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/features/my_apps/application/my_apps_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Settings -> My apps: the owner's other apps, each with what can be done
/// with it from here — open it, install it from its GitHub release, or find
/// it on GitHub / Google Play.
///
/// What a row offers comes only from its entry in `assets/my_apps.json` and
/// from what this device can do: Open and Install need the Windows build,
/// the Play and APK links are for phones (Play also works from a desktop
/// browser, where it can send the install to a phone).
class MyAppsCard extends ConsumerWidget {
  const MyAppsCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final registry = ref.watch(myAppsRegistryProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              spacing: 12,
              children: [
                const Icon(Icons.apps, color: AppColors.info),
                Expanded(
                  child: Tooltip(
                    message: l10n.myAppsSubtitle,
                    child: GradientText(
                      l10n.myAppsTitle,
                      style: theme.textTheme.titleMedium,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: l10n.myAppsRefresh,
                  icon: const Icon(Icons.refresh),
                  onPressed: () => ref.invalidate(myAppInstalledPathProvider),
                ),
              ],
            ),
            registry.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: LinearProgressIndicator(),
              ),
              error: (error, _) => Text(
                '$error',
                style: TextStyle(color: theme.colorScheme.error),
              ),
              data: (registry) => Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                spacing: 8,
                children: [
                  if (registry.apps.isEmpty)
                    Text(l10n.myAppsEmpty, style: theme.textTheme.bodySmall),
                  for (final app in registry.apps) _MyAppTile(app: app),
                  // A typo in the list is shown, not swallowed: otherwise an
                  // app just goes missing and nothing says why.
                  if (registry.problems.isNotEmpty)
                    Text(
                      '${l10n.myAppsProblems}\n${registry.problems.join('\n')}',
                      key: const Key('my-apps-problems'),
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.error),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

enum _Phase { idle, checking, downloading, waitingForInstaller }

class _MyAppTile extends ConsumerStatefulWidget {
  const _MyAppTile({required this.app});

  final MyAppEntry app;

  @override
  ConsumerState<_MyAppTile> createState() => _MyAppTileState();
}

class _MyAppTileState extends ConsumerState<_MyAppTile> {
  _Phase _phase = _Phase.idle;
  double? _progress;
  Timer? _watch;

  MyAppEntry get _app => widget.app;

  @override
  void dispose() {
    _watch?.cancel();
    super.dispose();
  }

  bool get _isAndroid =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  Future<void> _open(Uri uri) => ref.read(urlLauncherProvider)(uri);

  Future<void> _launch(String path) async {
    final l10n = AppLocalizations.of(context);
    final name = _app.nameFor(l10n.localeName);
    final ok = await ref.read(myAppsHostProvider).launch(path);
    if (!ok && mounted) AppToast.error(context, l10n.myAppsOpenFailed(name));
  }

  /// A public repository is read anonymously: a stale personal token would
  /// otherwise turn a download anyone can make into a 401.
  Future<String?> _token() async => _app.github!.isPrivate
      ? (await ref.read(githubTokenProvider.future)).token
      : null;

  /// The latest release, or null after telling the user why there is none.
  Future<MyAppRelease?> _latestRelease() async {
    final l10n = AppLocalizations.of(context);
    final github = _app.github!;
    final result = await ref
        .read(myAppReleasesProvider)
        .latest(github.repo, token: await _token());
    if (!mounted) return null;
    final problem = switch (result.problem) {
      null => null,
      MyAppReleaseProblem.notVisible => l10n.myAppsNotVisible(github.repo),
      MyAppReleaseProblem.tokenRejected => l10n.myAppsTokenRejected,
      MyAppReleaseProblem.unreachable => l10n.myAppsUnreachable,
    };
    if (problem != null) AppToast.error(context, problem);
    return result.release;
  }

  Future<void> _install() async {
    final l10n = AppLocalizations.of(context);
    final name = _app.nameFor(l10n.localeName);
    final host = ref.read(myAppsHostProvider);
    setState(() => _phase = _Phase.checking);
    try {
      final release = await _latestRelease();
      if (release == null || !mounted) return;
      final asset = release.windowsInstaller;
      if (asset == null) {
        AppToast.warning(context, l10n.myAppsNoInstaller(name));
        await _open(Uri.parse(release.pageUrl));
        return;
      }

      setState(() {
        _phase = _Phase.downloading;
        _progress = null;
      });
      final path = await host.download(
        asset,
        tag: release.tag,
        pageUrl: release.pageUrl,
        token: await _token(),
        onProgress: (p) {
          if (mounted) setState(() => _progress = p);
        },
      );
      if (!mounted) return;
      if (path == null) {
        AppToast.error(context, l10n.myAppsDownloadFailed);
        return;
      }
      if (!await host.runInstaller(path)) {
        if (mounted) AppToast.error(context, l10n.myAppsInstallerFailed);
        return;
      }
      if (!mounted) return;
      AppToast.info(context, l10n.myAppsInstallerStarted);
      _watchForInstall();
    } finally {
      if (mounted && _phase != _Phase.waitingForInstaller) {
        setState(() => _phase = _Phase.idle);
      }
    }
  }

  /// The installer runs on its own; look for the program every few seconds
  /// so Open appears once it is there, without asking for a refresh. Gives
  /// up after ten minutes — someone who walked away can press refresh.
  void _watchForInstall() {
    setState(() => _phase = _Phase.waitingForInstaller);
    var ticks = 0;
    _watch?.cancel();
    _watch = Timer.periodic(const Duration(seconds: 3), (timer) async {
      ticks++;
      ref.invalidate(myAppInstalledPathProvider(_app.id));
      final path = await ref.read(myAppInstalledPathProvider(_app.id).future);
      if (path != null || ticks >= 200) {
        timer.cancel();
        if (mounted) setState(() => _phase = _Phase.idle);
      }
    });
  }

  Future<void> _downloadApk() async {
    final l10n = AppLocalizations.of(context);
    final name = _app.nameFor(l10n.localeName);
    setState(() => _phase = _Phase.checking);
    try {
      final release = await _latestRelease();
      if (release == null || !mounted) return;
      final apk = release.apk;
      if (apk == null) {
        AppToast.warning(context, l10n.myAppsNoApk(name));
      }
      // A private repository's file url needs a signed-in browser, so the
      // release page (where the browser's own GitHub session applies) is
      // the honest target there.
      await _open(
        Uri.parse(
          apk == null || _app.github!.isPrivate ? release.pageUrl : apk.url,
        ),
      );
    } finally {
      if (mounted) setState(() => _phase = _Phase.idle);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final host = ref.watch(myAppsHostProvider);
    final lang = l10n.localeName;
    final description = _app.descriptionFor(lang);
    final windows = _app.windows;
    final github = _app.github;
    final android = _app.android;

    final onThisPc = host.canRunPrograms && windows != null;
    final installed = onThisPc
        ? ref.watch(myAppInstalledPathProvider(_app.id))
        : const AsyncValue<String?>.data(null);
    final path = installed.value;
    final busy = _phase != _Phase.idle;
    // The real icon once the program is installed; the registry's stand-in
    // before that, or if Windows could not hand the icon over.
    final appIcon =
        path != null ? ref.watch(myAppIconProvider(_app.id)).value : null;
    final placeholder =
        Icon(_iconFor(_app.icon), size: 32, color: AppColors.info);

    final actions = <Widget>[
      if (onThisPc && path != null)
        FilledButton.icon(
          key: Key('my-app-open-${_app.id}'),
          onPressed: () => _launch(path),
          icon: const Icon(Icons.open_in_new, size: 18),
          label: Text(l10n.myAppsOpen),
        )
      else if (onThisPc && github != null && installed.hasValue)
        FilledButton.icon(
          key: Key('my-app-install-${_app.id}'),
          onPressed: busy ? null : _install,
          icon: const Icon(Icons.download, size: 18),
          label: Text(l10n.myAppsInstall),
        ),
      if (_isAndroid && android != null && android.apk && github != null)
        FilledButton.tonalIcon(
          key: Key('my-app-apk-${_app.id}'),
          onPressed: busy ? null : _downloadApk,
          icon: const Icon(Icons.android, size: 18),
          label: Text(l10n.myAppsDownloadApk),
        ),
      if (android != null && android.playStore)
        OutlinedButton.icon(
          key: Key('my-app-play-${_app.id}'),
          onPressed: () => _open(android.playStoreUrl),
          icon: const Icon(Icons.shop, size: 18),
          label: Text(l10n.myAppsGooglePlay),
        ),
      if (github != null)
        IconButton(
          key: Key('my-app-github-${_app.id}'),
          tooltip: l10n.myAppsGithub(github.repo),
          onPressed: () => _open(github.pageUrl),
          icon: const Icon(Icons.code),
        ),
    ];

    final status = switch (_phase) {
      _Phase.checking => l10n.myAppsChecking,
      _Phase.downloading => _progress == null
          ? l10n.myAppsDownloadingStarted
          : l10n.myAppsDownloading((_progress! * 100).round()),
      _Phase.waitingForInstaller => l10n.myAppsWaitingForInstaller,
      _Phase.idle when onThisPc && installed.hasValue =>
        path != null ? l10n.myAppsInstalled : l10n.myAppsNotInstalled,
      _ => null,
    };

    return Container(
      key: Key('my-app-${_app.id}'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 8,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: 12,
            children: [
              if (appIcon != null)
                Image.memory(
                  appIcon,
                  key: Key('my-app-icon-${_app.id}'),
                  width: 32,
                  height: 32,
                  filterQuality: FilterQuality.medium,
                  errorBuilder: (_, __, ___) => placeholder,
                )
              else
                placeholder,
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 2,
                  children: [
                    Wrap(
                      spacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          _app.nameFor(lang),
                          style: theme.textTheme.titleSmall,
                        ),
                        if (github?.isPrivate ?? false)
                          Tooltip(
                            message: l10n.myAppsPrivateHelp,
                            child: Icon(
                              Icons.lock_outline,
                              size: 14,
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                      ],
                    ),
                    if (description != null)
                      Text(description, style: theme.textTheme.bodySmall),
                    if (status != null)
                      Text(
                        status,
                        key: Key('my-app-status-${_app.id}'),
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: path != null && _phase == _Phase.idle
                              ? AppColors.success
                              : theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (_phase == _Phase.downloading)
            LinearProgressIndicator(value: _progress),
          if (actions.isNotEmpty)
            Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: actions,
            ),
        ],
      ),
    );
  }

  static IconData _iconFor(String name) => switch (name) {
        'mosque' => Icons.mosque,
        'book' => Icons.menu_book,
        'calendar' => Icons.calendar_month,
        'chat' => Icons.chat_bubble_outline,
        'music' => Icons.music_note,
        'game' => Icons.sports_esports,
        'tools' => Icons.build,
        'school' => Icons.school,
        'heart' => Icons.favorite_outline,
        'alarm' => Icons.alarm,
        'notifications' => Icons.notifications_none,
        _ => Icons.apps,
      };
}
