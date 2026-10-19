import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/github/github_token_provider.dart';
import 'package:gratovo_toolbox/core/update/app_version.dart';
import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:gratovo_toolbox/core/update/package_info_provider.dart';
import 'package:gratovo_toolbox/core/update/update_installer.dart';
import 'package:gratovo_toolbox/core/update/update_plan.dart';
import 'package:gratovo_toolbox/core/update/update_sync_gate.dart';

/// How often the app re-asks what the latest release is. Hours, not minutes:
/// a release lands every few days at most.
const kUpdatePollInterval = Duration(hours: 6);

/// A short pause between "we're about to restart" landing on screen and the
/// process going away, on the unattended patch path where there is no dialog
/// to read. The manual path has the confirmation countdown instead.
const kUpdateRestartGrace = Duration(seconds: 5);

enum UpdatePhase {
  /// Nothing known yet — before the first check comes back.
  unknown,

  /// Checked, and this is the newest build there is.
  upToDate,

  /// A newer release exists and is being fetched.
  downloading,

  /// Downloaded and verified, waiting for a deliberate press of Update.
  /// Where every minor/major release ends up, and where a patch ends up too
  /// if it couldn't be installed without a UAC prompt.
  readyToInstall,

  /// The user pressed Update, but replication is still in flight and did not
  /// finish within [kUpdateSyncDrainTimeout]. Quitting now could strand
  /// queued edits, so the app stops and asks rather than deciding for them.
  awaitingConfirmation,

  /// The apply script is launched and the app is about to exit.
  installing,
}

@immutable
class UpdateState {
  const UpdateState({
    this.phase = UpdatePhase.unknown,
    this.release,
    this.kind,
    this.plan,
    this.progress = 0,
    this.stagedArchivePath,
    this.lastCheck,
  });

  final UpdatePhase phase;

  /// The release this state is about — null unless something newer was found.
  final UpdateRelease? release;
  final UpdateKind? kind;

  /// Where this update is going and how — decided at discovery, so the UI can
  /// say "installs beside your current version" before anything happens.
  final UpdatePlan? plan;

  /// 0..1 while [phase] is [UpdatePhase.downloading].
  final double progress;

  /// The verified download on disk, once fetched.
  final String? stagedArchivePath;
  final DateTime? lastCheck;

  /// Whether there is a newer version worth telling the user about. Drives
  /// the Settings nav badge.
  bool get hasUpdate => release != null && phase != UpdatePhase.upToDate;

  /// Whether the Update button next to the version should be pressable.
  bool get canInstallNow =>
      (phase == UpdatePhase.readyToInstall ||
          phase == UpdatePhase.awaitingConfirmation) &&
      stagedArchivePath != null;

  /// True when this update will be installed beside the current version
  /// rather than over it.
  bool get isSideBySide => plan != null && !plan!.inPlace;

  UpdateState copyWith({
    UpdatePhase? phase,
    UpdateRelease? release,
    UpdateKind? kind,
    UpdatePlan? plan,
    double? progress,
    String? stagedArchivePath,
    DateTime? lastCheck,
  }) {
    return UpdateState(
      phase: phase ?? this.phase,
      release: release ?? this.release,
      kind: kind ?? this.kind,
      plan: plan ?? this.plan,
      progress: progress ?? this.progress,
      stagedArchivePath: stagedArchivePath ?? this.stagedArchivePath,
      lastCheck: lastCheck ?? this.lastCheck,
    );
  }
}

/// Watches for new releases and decides, per release, whether to install it or
/// ask first.
///
/// The rule is about consent rather than risk. A patch shares its
/// `major.minor` with the build already running and approved — 1.4.2 to 1.4.8
/// — so it installs itself, over the top, and restarts. Anything that moves
/// the minor or the major is a different piece of software: it downloads in
/// the background so the wait is already paid for, then stops and waits for
/// the Update button, and when it does go in it goes into its own folder
/// beside the current one (see [UpdatePlan]).
///
/// Two things can stand an install down even after a press. If applying it
/// would need admin rights, an unattended patch declines rather than raising a
/// UAC dialog nobody asked for. And if replication is still in flight, the
/// install waits for it — and if it cannot finish, asks (see
/// [UpdatePhase.awaitingConfirmation]).
class UpdateController extends Notifier<UpdateState> {
  UpdateController({
    GithubReleaseSource? source,
    UpdateInstaller installer = const UpdateInstaller(),
    UpdateSyncGate? syncGate,
  })  : _injectedSource = source,
        _installer = installer,
        _injectedGate = syncGate;

  /// Only set by tests. In the app the source is built per check, because it
  /// carries the signed-in person's token and that can change while the app
  /// is running.
  final GithubReleaseSource? _injectedSource;
  final UpdateInstaller _installer;
  final UpdateSyncGate? _injectedGate;
  Timer? _poll;

  UpdateSyncGate get _gate => _injectedGate ?? ref.read(updateSyncGateProvider);

  /// Guards against two checks overlapping — the startup check and the first
  /// timer tick, or a manual press landing mid-poll.
  bool _busy = false;

  @override
  UpdateState build() {
    if (_installer.canSelfUpdate) {
      final timer =
          Timer.periodic(kUpdatePollInterval, (_) => unawaited(check()));
      _poll = timer;
      ref.onDispose(timer.cancel);
      // The startup check runs off a microtask rather than inline: this runs
      // during provider construction, and a network call plus a state write
      // from inside build() would be a modify-during-build error.
      scheduleMicrotask(check);
    }
    return const UpdateState();
  }

  /// Asks what the latest release is and acts on the answer. Safe to call at
  /// any time — a manual press mid-poll is ignored rather than queued.
  Future<void> check() async {
    if (_busy || !_installer.canSelfUpdate) return;
    // Nothing to do while a download is staged or being applied: the answer
    // wouldn't change what happens next, and re-downloading would throw away
    // bytes already on disk.
    if (state.phase == UpdatePhase.downloading ||
        state.phase == UpdatePhase.installing ||
        state.phase == UpdatePhase.awaitingConfirmation ||
        state.phase == UpdatePhase.readyToInstall) {
      return;
    }
    _busy = true;
    try {
      final current = AppVersion.tryParse(
        (await ref.read(packageInfoProvider.future)).version,
      );
      if (current == null) return;

      final token = (await ref.read(githubTokenProvider.future)).token;
      final source = _injectedSource ?? GithubReleaseSource(token: token);
      final release = await source.fetchLatest();
      final kind =
          release == null ? null : current.kindOfUpgradeTo(release.version);
      if (release == null || kind == null) {
        state = UpdateState(
          phase: UpdatePhase.upToDate,
          lastCheck: DateTime.now(),
        );
        return;
      }

      final plan = UpdatePlan.decide(
        release: release,
        kind: kind,
        currentInstallDir: _installer.installDirPath,
        pathSeparator: _installer.pathSeparator,
      );
      developer.log(
        'Update available: $current -> ${release.version} ($kind, '
        '${plan.artifact.name} -> ${plan.targetDir}).',
        name: 'gratovo.update',
      );
      state = UpdateState(
        phase: UpdatePhase.downloading,
        release: release,
        kind: kind,
        plan: plan,
        lastCheck: DateTime.now(),
      );
      await _download(release, plan, token: token);
    } catch (error, stackTrace) {
      developer.log(
        'Update check failed.',
        name: 'gratovo.update',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      state = state.copyWith(lastCheck: DateTime.now());
    } finally {
      _busy = false;
    }
  }

  Future<void> _download(
    UpdateRelease release,
    UpdatePlan plan, {
    String? token,
  }) async {
    final path = await _installer.download(
      release,
      token: token,
      onProgress: (p) {
        // The provider can be disposed mid-download (the app closing during a
        // poll); writing state then throws.
        if (state.phase == UpdatePhase.downloading) {
          state = state.copyWith(progress: p);
        }
      },
    );

    if (path == null) {
      // A failed download is not a failed app. Drop back to "nothing to do"
      // and let the next poll try again — the badge clears rather than sitting
      // there advertising an update that can't be fetched.
      state = UpdateState(
        phase: UpdatePhase.upToDate,
        lastCheck: DateTime.now(),
      );
      return;
    }

    state = state.copyWith(
      phase: UpdatePhase.readyToInstall,
      stagedArchivePath: path,
      progress: 1,
    );

    // Only a patch goes in by itself, and only where it can be done without
    // raising a prompt. Everything else waits for the Update button.
    if (plan.kind == UpdateKind.patch &&
        await _installer.canWriteTo(plan.targetDir)) {
      await installNow(unattended: true);
    }
  }

  /// Applies the staged download: drains replication, launches the apply
  /// script, then quits so it can replace the files this process holds open.
  ///
  /// [unattended] marks the automatic patch path, which refuses both to raise
  /// a UAC prompt and to interrupt a sync — it simply stands down and waits
  /// for a press, since nobody is watching to be asked.
  ///
  /// [force] skips the sync drain. Only the confirmation dialog passes it,
  /// and only after the user has read what they are overriding.
  Future<void> installNow({
    bool unattended = false,
    bool force = false,
  }) async {
    final archive = state.stagedArchivePath;
    final plan = state.plan;
    if (archive == null || plan == null) return;
    if (state.phase == UpdatePhase.installing) return;

    if (!force) {
      final drained = await _gate.drain(timeout: kUpdateSyncDrainTimeout);
      if (!drained) {
        if (unattended) {
          // Nobody is watching to be asked, and an automatic update is never
          // worth stranding queued edits over. Try again on the next press or
          // the next launch.
          developer.log(
            'Sync still in flight; leaving the patch staged rather than '
            'restarting underneath it.',
            name: 'gratovo.update',
            level: 800,
          );
          state = state.copyWith(phase: UpdatePhase.readyToInstall);
          return;
        }
        state = state.copyWith(phase: UpdatePhase.awaitingConfirmation);
        return;
      }
    }

    state = state.copyWith(phase: UpdatePhase.installing);
    final started = await _installer.install(
      archive,
      plan: plan,
      allowElevation: !unattended,
    );
    if (!started) {
      // Couldn't launch the apply script (or it needed rights an unattended
      // install won't ask for) — the download is still good, so fall back to
      // waiting for a press rather than losing it.
      state = state.copyWith(phase: UpdatePhase.readyToInstall);
      return;
    }

    _poll?.cancel();
    if (!force) {
      // Only the unattended path needs this; the confirmation dialog has
      // already spent longer than this on screen.
      await Future<void>.delayed(kUpdateRestartGrace);
    }
    await _installer.quitForUpdate();
  }

  /// Backs out of the confirmation without installing. The download stays
  /// staged, so pressing Update again costs nothing.
  void cancelConfirmation() {
    if (state.phase != UpdatePhase.awaitingConfirmation) return;
    state = state.copyWith(phase: UpdatePhase.readyToInstall);
  }
}

final updateProvider = NotifierProvider<UpdateController, UpdateState>(
  UpdateController.new,
);
