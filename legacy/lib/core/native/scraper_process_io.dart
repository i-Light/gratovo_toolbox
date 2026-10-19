import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';

import 'package:gratovo_toolbox/core/native/env_merge.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/native/pipeline_reset.dart';
import 'package:gratovo_toolbox/core/native/scraper_process_types.dart';

export 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
export 'package:gratovo_toolbox/core/native/pipeline_reset.dart';
export 'package:gratovo_toolbox/core/native/scraper_process_types.dart';

part 'scraper_process_io_data_dir.dart';
part 'scraper_process_io_gmail.dart';
part 'scraper_process_io_settings.dart';

/// Launches the real Python pipeline on this machine. Every method here
/// only ever runs behind `DesktopOnly` (see search_screen.dart /
/// influencer_profile_screen.dart) -- there's no code path that reaches
/// this on web (this whole file is swapped out for scraper_process_stub.dart
/// there, see scraper_process.dart) or, in practice, on mobile (nothing
/// stops `dart:io.Process` from existing on Android/iOS, but there's no
/// Python interpreter or `pipeline/` folder on a phone either, so nothing calls
/// this there).
/// Python on Windows encodes `print()` output with the machine's legacy ANSI
/// code page (cp1252 on a typical English install) whenever stdout is a pipe
/// rather than a console -- which is exactly what [Process.start] gives it.
/// The pipeline's own progress messages are full of em dashes ("Connected to
/// ... — pulling shared state"), and cp1252 encodes those as the single byte
/// 0x97, which is not valid UTF-8. Decoding that strictly threw
/// `FormatException: Unexpected extension byte` out of the stdout stream,
/// which is what made starting a search look like the app crashing.
///
/// Forcing the interpreter to emit UTF-8 fixes it at the source. `PYTHONUTF8`
/// enables UTF-8 mode (3.7+) and `PYTHONIOENCODING` covers older interpreters
/// and anything that re-wraps the streams; setting both is harmless.
/// [Process.start] merges this with the parent environment by default, so the
/// launched interpreter still sees PATH and everything else it needs.
/// `PYTHONUNBUFFERED` is a separate fix for a separate problem, and the one
/// that decides whether a run looks alive. Python block-buffers stdout when it
/// is a pipe rather than a console, so `search.py` could print two minutes of
/// progress and none of it would leave the interpreter until 8 KB had piled up
/// or the process exited -- which is precisely why starting a search looked
/// like nothing was happening and then dumped everything at the end. Set here
/// AND passed as `-u` below AND asked for by search.py's own
/// `reconfigure(line_buffering=True)`: any one of the three is enough, and the
/// interpreter a given machine happens to have decides which one takes.
const _utf8PythonEnvironment = <String, String>{
  'PYTHONUTF8': '1',
  'PYTHONIOENCODING': 'utf-8',
  'PYTHONUNBUFFERED': '1',
};

/// The second half of the same fix, and the half that matters even when the
/// first one does not take: a decoder that substitutes U+FFFD for a byte it
/// cannot read instead of throwing. A stray byte from a Python install that
/// ignores [_utf8PythonEnvironment] -- or from a library printing raw bytes --
/// should cost one unreadable character in the log panel, never the whole run.
const _lenientUtf8 = Utf8Codec(allowMalformed: true);

/// The name of the folder an installed build keeps its bundled Python
/// interpreter in, beside `gratovo_toolbox.exe` -- staged by
/// scripts/build_windows.ps1. Absent from a dev checkout, where the machine's
/// own interpreter is the right one.
const _bundledRuntimeDirName = 'pyruntime';

/// Where an installed build keeps the `data/` files it ships (`.env`,
/// `settings.json`) so a first launch has something to copy into the writable
/// per-user data folder. Deliberately NOT called `data`: an installed build
/// already has a `data\` beside the .exe and it belongs to the Flutter engine
/// (`flutter_assets`, `icudtl.dat`, `app.so`).
const _seedDirName = 'pipeline_data_seed';

/// How far up from a starting folder to look for `pipeline/search.py`.
/// `build\windows\x64\runner\Release\gratovo_toolbox.exe` sits five levels
/// below the repo root, which is the deepest case that matters.
const _maxRootSearchDepth = 6;

/// Locating the pipeline and launching its jobs. The rest of what the app
/// does to the pipeline's files is beside this, in the same library:
/// [PipelineDataDir] (creating, seeding and quarantining `data/`),
/// [PipelineSettings] (the JSON files inside it) and [GmailBridge]
/// (`tools/email_send.py`).
class ScraperProcess {
  const ScraperProcess._();

  /// Where `pipeline/` and the pipeline's `data/` are, for this machine and
  /// this way of launching the app.
  ///
  /// [projectRootOverride], when non-blank, is taken literally:
  /// `<override>/pipeline` and `<override>/data`, no searching and no per-user
  /// redirection. That is the Settings -> Search Tuning "Project root" escape
  /// hatch (python_environment_controller.dart), and an explicit answer should
  /// stay explicit.
  ///
  /// Otherwise this *looks* for the pipeline rather than assuming, because
  /// `Directory.current` is only the repo root when the app was started by
  /// `flutter run`. An installed build's working directory is wherever the
  /// shortcut pointed, so the previous `Directory.current.path + '\pipeline'`
  /// named a folder that does not exist and every launch died with
  /// `ProcessException: The directory name is invalid`. The search order is:
  ///
  ///  1. `<folder holding the .exe>/pipeline` -- the installed layout, which
  ///     scripts/build_windows.ps1 stages and scripts/installer.iss ships.
  ///  2. `Directory.current` and its ancestors -- `flutter run` from the repo
  ///     root, or from a subfolder of it.
  ///  3. the .exe's own ancestors -- running
  ///     `build\windows\x64\runner\Release\gratovo_toolbox.exe` by hand.
  ///
  /// Never null on desktop: with nothing found it still answers with the
  /// installed layout, so callers have a path to name in an error message
  /// rather than a null that says nothing. (The web stub answers null, which
  /// is what "no local pipeline on this platform at all" means -- see
  /// scraper_process_stub.dart.)
  static ScraperProcessPaths? resolvePaths({String? projectRootOverride}) {
    final override = projectRootOverride?.trim();
    if (override != null && override.isNotEmpty) {
      return ScraperProcessPaths(
        pipelineDir: _join(override, 'pipeline'),
        dataDir: _join(override, 'data'),
      );
    }
    final root = _findProjectRoot() ?? _executableDir();
    return ScraperProcessPaths(
      pipelineDir: _join(root, 'pipeline'),
      dataDir: _resolveDataDir(root),
    );
  }

  /// The interpreter to actually hand to [Process.start], given whatever
  /// Settings -> Search Tuning holds.
  ///
  /// A bundled runtime wins over the bare default `python`, because on the
  /// machines this app is *installed* on there is usually no `python` on PATH
  /// at all -- that is the whole reason the runtime is bundled. Anything the
  /// person actually typed (a venv's `python.exe`, `py`, a full path) wins
  /// over both: if someone went to the trouble of naming an interpreter, that
  /// is the one they meant.
  static String resolveInterpreter(String configured) {
    final trimmed = configured.trim();
    final isDefault = trimmed.isEmpty ||
        trimmed.toLowerCase() == 'python' ||
        trimmed.toLowerCase() == 'python.exe' ||
        trimmed.toLowerCase() == 'python3';
    if (!isDefault) return trimmed;
    return bundledInterpreter() ?? (trimmed.isEmpty ? 'python' : trimmed);
  }

  /// The bundled interpreter's full path, or null on a dev checkout with no
  /// `pyruntime/` staged beside the executable.
  static String? bundledInterpreter() {
    final runtimeDir = _join(_executableDir(), _bundledRuntimeDirName);
    final exe = Platform.isWindows
        ? _join(runtimeDir, 'python.exe')
        : _join(_join(runtimeDir, 'bin'), 'python3');
    return File(exe).existsSync() ? exe : null;
  }

  static bool _isProjectRoot(String candidate) =>
      File(_join(_join(candidate, 'pipeline'), 'search.py')).existsSync();

  static String? _findProjectRoot() {
    final exeDir = _executableDir();
    if (_isProjectRoot(exeDir)) return exeDir;
    return _walkUp(Directory.current.path) ?? _walkUp(exeDir);
  }

  static String? _walkUp(String start) {
    var dir = Directory(start).absolute;
    for (var depth = 0; depth < _maxRootSearchDepth; depth++) {
      if (_isProjectRoot(dir.path)) return dir.path;
      final parent = dir.parent;
      if (parent.path == dir.path) break;
      dir = parent;
    }
    return null;
  }

  /// `<root>/data` when that is the pipeline's own data folder, and the
  /// per-user folder otherwise.
  ///
  /// The check is not "does `<root>/data` exist" -- on an installed build it
  /// always does, and it belongs to the Flutter engine. Writing
  /// `keywords.json` and a 60 MB `gratovo.db` into the engine's asset folder
  /// would also put them somewhere an installer upgrade overwrites and an
  /// uninstall deletes, which is the wrong home for the only local copy of
  /// the team's data.
  static String _resolveDataDir(String root) {
    final candidate = _join(root, 'data');
    final isEngineData =
        Directory(_join(candidate, 'flutter_assets')).existsSync();
    if (!isEngineData && Directory(candidate).existsSync()) return candidate;
    return userDataDir();
  }

  /// The writable per-user data folder an installed build uses:
  /// `%LOCALAPPDATA%\Gratovo IMA ToolBox\data` on Windows.
  ///
  /// Outside the install folder on purpose -- an install can land in Program
  /// Files, where nothing is writable by the person running the app. It also
  /// means `gratovo.db` survives an upgrade and an uninstall.
  static String userDataDir() {
    final env = Platform.environment;
    final home = env['HOME'];
    final base = Platform.isWindows
        ? (env['LOCALAPPDATA'] ?? env['APPDATA'] ?? Directory.systemTemp.path)
        : (env['XDG_DATA_HOME'] ??
            (home == null
                ? Directory.systemTemp.path
                : _join(_join(home, '.local'), 'share')));
    return _join(_join(base, 'Gratovo IMA ToolBox'), 'data');
  }

  /// Writes [keywords] to `data/keywords.json` as this run's manifest (see
  /// [normalizeKeywords]), writes `data/run_config.json` from [runConfigJson],
  /// then starts `<pythonExecutable> -u search.py` with [paths.pipelineDir] as
  /// its working directory.
  ///
  /// The working directory is a convenience, not a requirement: `config.py`
  /// resolves `data/` from its own file location outwards, so the pipeline
  /// finds its files no matter where it is launched from. That was not true
  /// of the previous layout, where a wrong working directory meant silently
  /// reading no settings at all. On an installed build even that fallback is
  /// wrong -- `pipeline/`'s sibling there is the install folder, not a data
  /// folder anyone can write to -- so [_environmentFor] passes
  /// `GRATOVO_DATA_DIR` and `config.py` prefers it over both.
  static Future<PipelineLaunchResult> startSearch({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required List<String> keywords,
    required Map<String, Object?> runConfigJson,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    await _writeKeywordsFile(paths, keywords);
    await _writeRunConfigFile(paths, runConfigJson);

    final process = await Process.start(
      resolveInterpreter(pythonExecutable),
      // -u: unbuffered stdout, so progress arrives while it is happening
      // rather than in one lump at the end. See [_utf8PythonEnvironment].
      ['-u', 'search.py'],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      mode: ProcessStartMode.normal,
    );
    return _streamProcess(process);
  }

  /// Wires a just-started process' stdout+stderr into one merged, line-by-line
  /// broadcast stream and hands back a [PipelineLaunchResult] -- shared by
  /// every long-running launch ([startSearch], [backfillChannelVideos]) so the
  /// stream-merging and stop-signal plumbing exists in one place.
  static PipelineLaunchResult _streamProcess(Process process) {
    final controller = StreamController<String>.broadcast();
    var pending = 2;
    void onDone() {
      pending -= 1;
      if (pending == 0) controller.close();
    }

    process.stdout
        .transform(_lenientUtf8.decoder)
        .transform(const LineSplitter())
        .listen(controller.add, onDone: onDone, onError: controller.addError);
    process.stderr
        .transform(_lenientUtf8.decoder)
        .transform(const LineSplitter())
        .listen(controller.add, onDone: onDone, onError: controller.addError);

    return PipelineLaunchResult(
      stdoutLines: controller.stream,
      exitCode: process.exitCode,
      // SIGINT rather than SIGTERM/kill: both search.py and enrich.py handle
      // KeyboardInterrupt, committing what they already have before exiting.
      // On Windows `Process.kill` with sigint does not deliver a real console
      // interrupt, so the fallback below terminates it outright -- both
      // scripts commit after every batch, so the worst case is losing the
      // batch in flight.
      stop: () async {
        final interrupted = process.kill(ProcessSignal.sigint);
        if (!interrupted) return false;
        if (!Platform.isWindows) return true;
        return process.kill(ProcessSignal.sigterm);
      },
    );
  }

  /// `search.py --refetch <handle>` -- the manual force-refresh path
  /// (`run_manual_refetch` in search.py) already exits quickly for one
  /// handle, so this waits for the whole thing rather than streaming it
  /// live like [startSearch] does; the caller (Influencer Profile's
  /// Refresh button) just needs to know it's done, not watch it happen.
  static Future<ProcessResultLite> refetchHandle({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String handle,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final result = await Process.run(
      resolveInterpreter(pythonExecutable),
      ['search.py', '--refetch', handle],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      // Must match the encoding forced by [_utf8PythonEnvironment]. The
      // default here is `systemEncoding`, which on Windows is the machine's
      // ANSI code page -- it would turn every em dash the pipeline prints
      // into mojibake now that the interpreter is emitting real UTF-8.
      stdoutEncoding: _lenientUtf8,
      stderrEncoding: _lenientUtf8,
    );
    final output = [
      if ((result.stdout as String).isNotEmpty) result.stdout,
      if ((result.stderr as String).isNotEmpty) result.stderr,
    ].join('\n');
    return ProcessResultLite(exitCode: result.exitCode, output: output);
  }

  /// `search.py --catch-up-videos` -- fetches the normal ~15-video recent-
  /// uploads window for every channel in the WHOLE local store that has never
  /// had it, not just one channel. Distinct from [backfillChannelVideos]:
  /// this is the same cheap window ordinary discovery already fetches for a
  /// newly found channel (no per-channel quota multiplier), just applied to
  /// the backlog of channels a search never got back around to -- so it is
  /// safe to run automatically in the background rather than needing a
  /// budget ceiling the way the wide multi-month backfill does. See
  /// `VideoCatchUpNotifier` (features/search/application/video_catchup_controller.dart)
  /// for what launches this and why it can also be told to [PipelineLaunchResult.stop].
  static Future<PipelineLaunchResult> catchUpMissingVideos({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    int? limit,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final process = await Process.start(
      resolveInterpreter(pythonExecutable),
      [
        '-u',
        'search.py',
        '--catch-up-videos',
        if (limit != null) ...['--catch-up-limit', '$limit'],
      ],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      mode: ProcessStartMode.normal,
    );
    return _streamProcess(process);
  }

  /// `tools/enrich.py --apply --only backfill --handle <handle> --months <n>`
  /// -- pulls further back than the 15 recent uploads discovery stores, so
  /// the CRM calculator has a wider basis to average over.
  ///
  /// Deliberately NOT `--refetch`: that re-reads the same recent window and
  /// would never add an older upload. This is the one job that adds new video
  /// rows rather than filling in existing ones, which is why it is a separate
  /// script with its own API-call ceiling -- a backfill on a daily uploader
  /// can cost real quota, and the ceiling is what stops it from taking the
  /// budget the next day's discovery run needs.
  ///
  /// Streamed like [startSearch] rather than run to completion: a wide window
  /// on a prolific channel walks several paced, HTML-scraped pages before it
  /// ever reaches the API-quota part, and used to run entirely silently --
  /// the caller only found out it had finished when it finished. See
  /// `BackfillRunNotifier` (features/search/application/backfill_run_controller.dart)
  /// for what reads this stream.
  static Future<PipelineLaunchResult> backfillChannelVideos({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String handle,
    required int months,
    int maxApiCalls = 20,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final process = await Process.start(
      resolveInterpreter(pythonExecutable),
      [
        '-u',
        'tools/enrich.py',
        '--apply',
        '--only',
        'backfill',
        '--handle',
        handle,
        '--months',
        '$months',
        '--max-api-calls',
        '$maxApiCalls',
      ],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      mode: ProcessStartMode.normal,
    );
    return _streamProcess(process);
  }

  /// `search.py --refetch <handle>`, streamed like [startSearch] rather than
  /// run to completion like [refetchHandle].
  ///
  /// Same pipeline job as [refetchHandle] — `run_manual_refetch` resolves the
  /// handle, lifts any tombstone (`store.unarchive`), records the discovery
  /// under `__manual_refetch__`, forces a full re-fetch of the channel and its
  /// recent uploads, and pushes. The difference is only in how the caller
  /// watches it: the Archive page's "free this channel" action wants the run's
  /// progress on screen the way a search run's is, so this hands back a live
  /// stream instead of a finished [ProcessResultLite]. See `ReenrichRunNotifier`
  /// (features/search/application/reenrich_run_controller.dart).
  static Future<PipelineLaunchResult> reenrichHandleStreamed({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String handle,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final process = await Process.start(
      resolveInterpreter(pythonExecutable),
      ['-u', 'search.py', '--refetch', handle],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      mode: ProcessStartMode.normal,
    );
    return _streamProcess(process);
  }

  /// `tools/news.py --refresh` — fetches every enabled industry feed and
  /// stores what it returned.
  ///
  /// This runs here, on a desktop machine, rather than in the app for a
  /// reason the News page depends on: a browser will not let a page read a
  /// publisher's feed cross-origin, and almost no publisher permits it. One
  /// trusted machine fetches and the whole team reads the result, which also
  /// means one request per feed instead of one per person per page open.
  /// `tools/video_stats.py --video <link> --json` — one video's views, for a
  /// deliverable's 30-day report. Reads one number from YouTube; stores
  /// nothing. The raw output is parsed by `video_stats_protocol.dart`.
  static Future<ProcessResultLite> videoStats({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String video,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final result = await Process.run(
      resolveInterpreter(pythonExecutable),
      ['tools/video_stats.py', '--video', video, '--json'],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      stdoutEncoding: _lenientUtf8,
      stderrEncoding: _lenientUtf8,
    );
    final output = [
      if ((result.stdout as String).isNotEmpty) result.stdout,
      if ((result.stderr as String).isNotEmpty) result.stderr,
    ].join('\n');
    return ProcessResultLite(exitCode: result.exitCode, output: output);
  }

  static Future<ProcessResultLite> refreshNewsFeeds({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final result = await Process.run(
      resolveInterpreter(pythonExecutable),
      ['tools/news.py', '--refresh'],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      stdoutEncoding: _lenientUtf8,
      stderrEncoding: _lenientUtf8,
    );
    final output = [
      if ((result.stdout as String).isNotEmpty) result.stdout,
      if ((result.stderr as String).isNotEmpty) result.stderr,
    ].join('\n');
    return ProcessResultLite(exitCode: result.exitCode, output: output);
  }

  /// `search.py --push-only` — sends everything this machine's pipeline store
  /// holds that Supabase has not seen yet, and exits.
  ///
  /// The other half of the sync button in the app chrome. That button drives
  /// `SyncEngine.syncNow`, which uploads the *app's* queued edits and pulls the
  /// team's rows down — but the channels and videos a search found on this
  /// machine do not live in the mirror at all. They live in the pipeline's own
  /// `gratovo.db`, and until now the only thing that ever pushed them was a
  /// search run: a run that finished while the network was down (or against a
  /// server that answered with a 500) left its finds sitting in a local file
  /// with nothing in the app able to send them, until somebody happened to run
  /// another search.
  ///
  /// Cheap to call: `sync.push_all` is incremental — it sends what has changed
  /// since each table's last successful push, and the cursor only advances on
  /// a successful upsert, so a failure here retries the same rows next time
  /// rather than skipping them.
  static Future<ProcessResultLite> pushLocalStore({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final result = await Process.run(
      resolveInterpreter(pythonExecutable),
      ['search.py', '--push-only'],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      stdoutEncoding: _lenientUtf8,
      stderrEncoding: _lenientUtf8,
    );
    final output = [
      if ((result.stdout as String).isNotEmpty) result.stdout,
      if ((result.stderr as String).isNotEmpty) result.stderr,
    ].join('\n');
    return ProcessResultLite(exitCode: result.exitCode, output: output);
  }

  /// `search.py --pull-only` — downloads the team's shared rows into this
  /// machine's `gratovo.db` and exits, without touching YouTube or running a
  /// single keyword.
  ///
  /// This is the whole of the "Starting the pipeline..." wait, moved off the
  /// Start button. A run's first act used to be `sync.pull_all`, a *full*
  /// download of every shared table — around fifty seconds at the team's
  /// current size, paid every single time somebody pressed Start, before any
  /// searching began. It is not per-run work: it is the same download whether
  /// it happens now or happened five minutes ago. `PipelineWarmupNotifier`
  /// runs this in the background as the app launches, and `search.py` skips
  /// its own pull when one landed recently enough (see its
  /// `DEFAULT_PULL_MAX_AGE_SECONDS`), so a search started after that begins
  /// with the first keyword.
  ///
  /// [force] passes `--force-pull`, for the "Refresh now" action on the search
  /// page: somebody asking for it explicitly means it, freshness window or not.
  ///
  /// [onLine] sees every line as it is printed. A pull is seconds when
  /// nothing changed, but the first one on a machine is the pipeline's
  /// one-time bootstrap -- thousands of objects moved in both directions,
  /// minutes on end -- and it reports its position line by line
  /// (`[step]`, `[sync-io]`; see `search_progress_parser.dart`) precisely so
  /// that wait can be shown as something rather than a spinner.
  static Future<ProcessResultLite> pullSharedState({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    bool force = false,
    void Function(String line)? onLine,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final process = await Process.start(
      resolveInterpreter(pythonExecutable),
      ['-u', 'search.py', '--pull-only', if (force) '--force-pull'],
      workingDirectory: paths.pipelineDir,
      environment: _environmentFor(paths),
      mode: ProcessStartMode.normal,
    );
    final launch = _streamProcess(process);
    final lines = <String>[];
    final drained = launch.stdoutLines.listen(
      (line) {
        lines.add(line);
        onLine?.call(line);
      },
      onError: (Object error) => lines.add('[app] log output error: $error'),
    ).asFuture<void>();
    final exitCode = await launch.exitCode;
    await drained;
    return ProcessResultLite(exitCode: exitCode, output: lines.join('\n'));
  }

  /// `search.py --archive-ids <file>` -- archives channels through the
  /// pipeline: tombstoned locally, their objects deleted from the R2 bucket,
  /// and the archive announced in the catalog. [entries] is a list of
  /// `{channel_id, label}`; it goes through a temp file rather than the
  /// command line because a bulk clean can name thousands of ids.
  static Future<ProcessResultLite> archiveChannels({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required List<Map<String, Object?>> entries,
  }) =>
      _runIdsCommand(
        pythonExecutable: pythonExecutable,
        paths: paths,
        flag: '--archive-ids',
        payload: entries,
      );

  /// `search.py --unarchive-ids <file>` -- brings channels back from the
  /// archive, flagged for a fresh scrape, and announces it.
  static Future<ProcessResultLite> restoreChannels({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required List<String> channelIds,
  }) =>
      _runIdsCommand(
        pythonExecutable: pythonExecutable,
        paths: paths,
        flag: '--unarchive-ids',
        payload: channelIds,
      );

  static Future<ProcessResultLite> _runIdsCommand({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String flag,
    required Object payload,
  }) async {
    _requirePipelineDir(paths);
    await PipelineDataDir.ensureDataDir(paths);
    final dir = await Directory.systemTemp.createTemp('gratovo-ids-');
    final file = File(_join(dir.path, 'ids.json'));
    try {
      await file.writeAsString(jsonEncode(payload));
      final result = await Process.run(
        resolveInterpreter(pythonExecutable),
        ['search.py', flag, file.path],
        workingDirectory: paths.pipelineDir,
        environment: _environmentFor(paths),
        stdoutEncoding: _lenientUtf8,
        stderrEncoding: _lenientUtf8,
      );
      final output = [
        if ((result.stdout as String).isNotEmpty) result.stdout,
        if ((result.stderr as String).isNotEmpty) result.stderr,
      ].join('\n');
      return ProcessResultLite(exitCode: result.exitCode, output: output);
    } finally {
      try {
        await dir.delete(recursive: true);
      } catch (_) {}
    }
  }

  /// Rewrites `data/keywords.json` with exactly the keywords this run should
  /// work, in order.
  ///
  /// Deliberately an overwrite, not a merge. See [normalizeKeywords] for the
  /// full reasoning; the short version is that the file is a handoff for one
  /// run rather than a shared queue, so what the person typed is what runs.
  /// Nothing is lost by overwriting it: `store.seed_keywords` has already
  /// recorded every keyword in `gratovo.db`, which is the durable history.
  static Future<void> _writeKeywordsFile(
    ScraperProcessPaths paths,
    List<String> keywords,
  ) async {
    final file = File('${paths.dataDir}${Platform.pathSeparator}keywords.json');
    await file.parent.create(recursive: true);
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(normalizeKeywords(keywords)),
    );
  }

  static Future<void> _writeRunConfigFile(
    ScraperProcessPaths paths,
    Map<String, Object?> runConfigJson,
  ) async {
    final file =
        File('${paths.dataDir}${Platform.pathSeparator}run_config.json');
    await file.parent.create(recursive: true);
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(runConfigJson),
    );
  }
}

/// The environment every pipeline invocation runs with.
///
/// `GRATOVO_DATA_DIR` is the half that matters for an installed build:
/// `config.py` otherwise resolves `data/` as the sibling of `pipeline/`,
/// which on an installed build is inside the install folder and may well be
/// read-only. This points it at the same writable per-user folder the app
/// itself reads, so both sides agree on where `gratovo.db` is.
Map<String, String> _environmentFor(ScraperProcessPaths paths) => {
      ..._utf8PythonEnvironment,
      'GRATOVO_DATA_DIR': paths.dataDir,
    };

/// Throws naming the path it actually looked at, rather than letting
/// [Process.start] raise `The directory name is invalid` -- which names
/// nothing, and sent exactly this bug looking in the wrong place.
void _requirePipelineDir(ScraperProcessPaths paths) {
  if (Directory(paths.pipelineDir).existsSync()) return;
  throw StateError(
    'The Python pipeline is missing: no folder at "${paths.pipelineDir}". '
    'Set Settings -> Search Tuning -> "Project root" to the folder holding '
    'pipeline/ and data/, or reinstall the app.',
  );
}

// ---- root resolution -------------------------------------------------

String _join(String a, String b) => '$a${Platform.pathSeparator}$b';

String _executableDir() => File(Platform.resolvedExecutable).parent.path;
