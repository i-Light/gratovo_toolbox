import 'dart:developer' as developer;
import 'dart:io' show Directory, Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/app.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/logging/crash_log.dart';
import 'package:gratovo_toolbox/core/native/pending_merge_boot.dart';
import 'package:gratovo_toolbox/core/native/pipeline_bridge.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/notifications/local_notification_service.dart';
import 'package:gratovo_toolbox/core/startup/boot_timeline.dart';
import 'package:gratovo_toolbox/core/startup/startup_launch_store.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/core/time/tz_database.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:window_manager/window_manager.dart';

/// Brings the backend up before the first frame, then hands the result to the
/// widget tree as a provider override.
///
/// `Supabase.initialize()` can only run once per process and has to complete
/// before anything queries, so it belongs here rather than in a provider. Its
/// outcome — including failure — is injected rather than thrown: a wrong
/// server address or an offline machine must land the user on the sign-in
/// screen with an explanation they can act on, not a red error screen with a
/// stack trace.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Every awaited step below is on the way to the first frame; see
  // `boot_timeline.dart` for where the numbers go.
  final timeline = BootTimeline();

  if (StartupLaunchStore.isAvailable) {
    final packageInfo = await PackageInfo.fromPlatform();
    StartupLaunchStore.setup(
      appName: packageInfo.appName,
      appPath: Platform.resolvedExecutable,
    );
  }

  await windowManager.ensureInitialized();
  timeline.mark('window');

  // Room for the decoded bitmaps a long list scroll touches. The influencer
  // list keeps appending 50-row pages, each with an avatar and often a video
  // thumbnail, so the framework default (1000 images / 100 MB) starts evicting
  // decoded images a few hundred rows in — and scrolling back up then re-reads
  // and re-decodes every one of them, one screenful per frame, which is the
  // stutter. These are small images (avatars ~44px, thumbnails ~96px), so a
  // higher count costs little memory. The `ImageProvider`-reference cache that
  // keeps re-resolves off the disk is `_maxEntries` in remote_image.dart.
  PaintingBinding.instance.imageCache
    ..maximumSize = 3000
    ..maximumSizeBytes = 256 << 20;

  // Uncaught errors go to a file in the support directory (beside the sync
  // log) before anything else runs, so a crash during boot is written down
  // too. Best-effort: no directory, no file, same app.
  await _installCrashLog();
  timeline.mark('crashLog');

  // Loads the IANA timezone database and points tz.local at the device zone
  // before the first frame renders a timestamp. Guarded internally — the
  // worst case  everything renders in UTC, never a failed launch.
  await initTimeZoneDatabase();
  timeline.mark('timeZones');

  // Registers the platform notification plugin so a scheduled follow-up can
  // raise an OS toast. Best-effort and self-guarding: a build with no plugin
  // registered just never shows one, and the in-app due/overdue list stays
  // the source of truth regardless.
  await LocalNotificationService().init();
  timeline.mark('notifications');

  // Makes sure the pipeline's data folder exists and holds the files an
  // install shipped (`.env`, `settings.json`, the email-critique library)
  // before any provider opens a database inside it. Order matters: an
  // installed build keeps that folder under %LOCALAPPDATA%, and
  // `openLocalDb` would otherwise create an empty `email_library.db` there
  // first and the shipped one would never be copied in. No-op on web, on a
  // dev checkout (nothing is staged to seed from), and on every launch after
  // the first.
  //
  // This also applies any pending `reset_manifest.json` action — a stale
  // bundled database this build retires is moved into a quarantine folder
  // here, BEFORE the seed copy runs, so the fresh copy lands in its place. The
  // returned index feeds the "needs manual merge" board in Settings.
  final pendingMerge = await _seedPipelineData();
  timeline.mark('pipelineData');

  // Reads the per-device override if Settings → Account → Advanced set one,
  // otherwise the compiled-in project.
  final config = await const SupabaseConfigStore().read();

  late final SupabaseBoot boot;
  if (!config.isConfigured) {
    boot = SupabaseBoot(
      config: config,
      error: 'No server address or public key is configured.',
    );
  } else {
    try {
      // `anonKey` is deprecated in favour of `publishableKey`, and kept
      // deliberately: this project's key is a legacy JWT (`role: anon`), which
      // is what `anonKey` names. The two parameters feed the same header, so
      // switching is safe — but do it when the Supabase project is migrated to
      // a new-style `sb_publishable_…` key, not before, so the parameter name
      // never disagrees with the kind of key being passed.
      // ignore: deprecated_member_use
      await Supabase.initialize(url: config.url, anonKey: config.anonKey);
      boot = SupabaseBoot(config: config, client: Supabase.instance.client);
    } catch (error) {
      // Deliberately broad: a malformed URL, a DNS failure and a rejected key
      // all arrive as different exception types, and the app's response to
      // every one of them is the same — start signed out and say why.
      boot = SupabaseBoot(config: config, error: error);
    }
  }

  // The local database and its sync engine. Opened after Supabase because the
  // engine authenticates with that session, and before the first frame because
  // a repository provider read during the first build has to already have it.
  timeline.mark('supabase');
  final sync = await _bootSync(boot);
  timeline.mark('localDatabase');

  runApp(
    ProviderScope(
      overrides: [
        supabaseBootProvider.overrideWithValue(boot),
        syncBootProvider.overrideWithValue(sync),
        pendingMergeBootProvider.overrideWithValue(pendingMerge),
      ],
      child: const GratovoApp(),
    ),
  );
  _recordFirstFrame(timeline);
}

/// Writes the launch's timeline once the first frame is on screen.
void _recordFirstFrame(BootTimeline timeline) {
  if (kIsWeb) return;
  WidgetsBinding.instance.addPostFrameCallback((_) async {
    final line = timeline.describe(firstFrameMs: timeline.elapsedMilliseconds);
    developer.log(line, name: 'gratovo.boot');
    try {
      final dir = await getApplicationSupportDirectory();
      BootTimeline.append(dir.path, line);
    } catch (_) {
      // Best-effort, like the crash log.
    }
  });
}

/// Points the framework's error hooks at `gratovo_crash_log.txt`. Broad
/// catch on purpose: the one thing a crash logger must not do is crash the
/// launch.
Future<void> _installCrashLog() async {
  if (kIsWeb) return;
  try {
    final logs = await getApplicationSupportDirectory();
    CrashLog.install(logs.path);
  } catch (error) {
    developer.log(
      'Could not open the crash log; uncaught errors will only reach the '
      'console.',
      name: 'gratovo.boot',
      level: 900,
      error: error,
    );
  }
}

/// Applies any pending `reset_manifest.json` action, then creates the
/// pipeline's data folder and copies in whatever the install shipped that is
/// not there yet — see `PipelineDataDir.applyPendingResets` and
/// `PipelineDataDir.ensureDataDir`.
///
/// Returns the merge-quarantine index as it stands afterwards (empty on web
/// and on a machine with nothing to set aside), which `main()` hands to the
/// widget tree via `pendingMergeBootProvider`.
///
/// Best-effort like every other boot step here: a machine that cannot write
/// there should land on a running app that reports the feature as
/// unavailable, not on a stack trace.
Future<MergeQuarantineIndex> _seedPipelineData() async {
  try {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return MergeQuarantineIndex.empty;
    // Before ensureDataDir: a retired database has to be moved out of the way
    // first so the fresh seed copy can take its place.
    final index = await PipelineDataDir.applyPendingResets(paths);
    await PipelineDataDir.ensureDataDir(paths);
    return index;
  } catch (error, stackTrace) {
    developer.log(
      'Could not prepare the pipeline data folder; features that read it '
      'will show as unavailable.',
      name: 'gratovo.boot',
      level: 900,
      error: error,
      stackTrace: stackTrace,
    );
    return MergeQuarantineIndex.empty;
  }
}

/// Opens the local database and its sync engine, or explains why there isn't
/// one.
///
/// Three ways to come back without an engine, none of them a red screen:
///
///  * no Supabase client — nothing to sync with (the database itself would
///    still be usable, but every repository needs the engine to reach it, so
///    the app runs on mocks and says so);
///  * web, where `openSyncEngine` is a stub that always returns null;
///  * the database file could not be opened.
///
/// The database is the pipeline's `data/database/gratovo.db`, resolved the
/// same way the search page resolves it. The sync log goes to the app's own
/// support directory.
Future<SyncBoot> _bootSync(SupabaseBoot boot) async {
  if (boot.client == null || kIsWeb) return const SyncBoot();

  try {
    final env = await readPersistedPythonEnvironment();
    final override = env.projectRootOverride.trim();
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride: override.isEmpty ? null : override,
    );
    if (paths == null) {
      return const SyncBoot(
        error: 'The pipeline data folder could not be found, so there is no '
            'local database to open. Set the project root in Settings.',
      );
    }
    await Directory(paths.databaseDir).create(recursive: true);
    final logs = await getApplicationSupportDirectory();
    final engine = await openSyncEngine(
      client: boot.client!,
      databasePath: paths.dbPath,
      logDirectory: logs.path,
      pipeline: const ProcessPipelineBridge(),
    );
    return SyncBoot(engine: engine);
  } catch (error) {
    // Deliberately broad, and deliberately not rethrown — the same judgement
    // the Supabase boot above makes.
    return SyncBoot(error: error);
  }
}
