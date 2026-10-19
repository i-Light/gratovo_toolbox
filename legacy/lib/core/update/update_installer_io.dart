import 'dart:async';
import 'dart:developer' as developer;
import 'dart:io';

import 'package:gratovo_toolbox/core/update/github_release_source.dart';
import 'package:gratovo_toolbox/core/update/update_plan.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// Downloads a release and applies it, either by running the Inno Setup
/// installer or by unpacking the .zip.
///
/// The swap can't happen inside this process — Windows holds a lock on a
/// running .exe and its loaded DLLs, so nothing can overwrite them while the
/// app is alive. The shape used here is the standard one: write a small
/// PowerShell script to temp, launch it detached, and quit. The script waits
/// for this process to exit, applies the update, and launches the result.
///
/// The ordering inside that script is the part that matters. For the archive
/// path it expands and validates the new build completely, in a temp folder,
/// and only touches the target directory once it's holding something it has
/// confirmed is a real build. A download that turns out to be truncated, not
/// a zip, or missing the .exe therefore leaves the working install untouched.
class UpdateInstaller {
  const UpdateInstaller({http.Client? client}) : _client = client;

  final http.Client? _client;

  /// Self-updating is Windows-only here. macOS and Linux builds exist as
  /// `flutter run` checkouts rather than staged installs, and the release
  /// workflow only publishes Windows artifacts — there is nothing to swap in.
  bool get canSelfUpdate => Platform.isWindows;

  /// The folder holding the running .exe, its DLLs, and the `pipeline/` and
  /// `pyruntime/` folders staged beside it.
  String get installDirPath => File(Platform.resolvedExecutable).parent.path;

  /// Surfaced here so `UpdateController` can build a sibling path without
  /// importing `dart:io` itself — it is compiled into the web build too,
  /// where `dart:io` does not exist.
  String get pathSeparator => Platform.pathSeparator;

  /// Whether [dir] can be written without prompting for admin rights.
  ///
  /// This gates unattended patch installs: a silent background update that
  /// suddenly throws a UAC dialog isn't silent, and a UAC prompt appearing
  /// with no explanation is exactly the kind of thing people rightly refuse.
  /// When this is false the download is staged and waits for the deliberate
  /// press, where the prompt has context.
  ///
  /// Probes with a real write rather than inspecting ACLs: what matters is
  /// whether the copy will succeed, and the only faithful test of that is
  /// trying it. A target that does not exist yet (the side-by-side case) is
  /// judged by its parent, which is where it will have to be created.
  Future<bool> canWriteTo(String dir) async {
    if (!canSelfUpdate) return false;
    final probeDir =
        await Directory(dir).exists() ? dir : File(dir).parent.path;
    final probe =
        File('$probeDir${Platform.pathSeparator}.gratovo-update-probe');
    try {
      await probe.writeAsString('probe', flush: true);
      await probe.delete();
      return true;
    } on FileSystemException {
      return false;
    }
  }

  /// Streams the release's chosen asset to a temp file, reporting 0..1
  /// progress when a length is known. Returns the path, or null on any
  /// failure.
  ///
  /// Downloads to a `.part` file and renames on success, so a half-finished
  /// download interrupted by a crash or a power cut can never be mistaken for
  /// a complete one on the next run.
  Future<String?> download(
    UpdateRelease release, {
    String? token,
    void Function(double progress)? onProgress,
  }) async {
    final asset = release.preferredAsset;
    if (asset == null) return null;

    final client = _client ?? http.Client();
    IOSink? sink;
    File? partial;
    try {
      final dir = Directory(
        '${(await getTemporaryDirectory()).path}${Platform.pathSeparator}'
        'gratovo-update',
      );
      await dir.create(recursive: true);

      final target = File('${dir.path}${Platform.pathSeparator}${asset.name}');
      partial = File('${target.path}.part');
      if (await partial.exists()) await partial.delete();

      final response = await _fetchAsset(client, asset, token);
      if (response.statusCode != 200) {
        developer.log(
          'Update download got HTTP ${response.statusCode}.',
          name: 'gratovo.update',
          level: 900,
        );
        return null;
      }

      // Prefer the length the server reports; fall back to the size the
      // release listed so progress still moves on a chunked response.
      final total = response.contentLength ?? asset.sizeBytes;
      var received = 0;
      sink = partial.openWrite();
      await for (final chunk in response.stream) {
        sink.add(chunk);
        received += chunk.length;
        if (total > 0) onProgress?.call((received / total).clamp(0.0, 1.0));
      }
      await sink.flush();
      await sink.close();
      sink = null;

      // A truncated download is the common failure here, and it is worth
      // catching before the script ever runs even though the script validates
      // too.
      if (asset.sizeBytes > 0 && received != asset.sizeBytes) {
        developer.log(
          'Update download ended at $received bytes, expected '
          '${asset.sizeBytes}; discarding.',
          name: 'gratovo.update',
          level: 900,
        );
        await partial.delete();
        return null;
      }

      if (await target.exists()) await target.delete();
      await partial.rename(target.path);
      onProgress?.call(1);
      return target.path;
    } catch (error, stackTrace) {
      developer.log(
        'Update download failed.',
        name: 'gratovo.update',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      try {
        await sink?.close();
        if (partial != null && await partial.exists()) await partial.delete();
      } catch (_) {
        // Cleanup is best-effort; the temp folder is disposable either way.
      }
      return null;
    } finally {
      if (_client == null) client.close();
    }
  }

  /// Asks the release API for the asset and follows its redirect by hand.
  ///
  /// GitHub answers the asset url with a 302 to a signed storage url. That
  /// url must be fetched WITHOUT the Authorization header — storage rejects a
  /// request that carries both its own signature and a bearer token — and
  /// `http` would forward the header on an automatic redirect, so the hop is
  /// done explicitly. A public repo's `browser_download_url` never redirects
  /// through the API and just streams on the first request.
  Future<http.StreamedResponse> _fetchAsset(
    http.Client client,
    ReleaseAsset asset,
    String? token,
  ) async {
    final first = http.Request('GET', Uri.parse(asset.downloadUrl))
      ..followRedirects = false
      ..headers['User-Agent'] = 'gratovo-toolbox-updater'
      ..headers['Accept'] = 'application/octet-stream';
    if (token != null && token.isNotEmpty) {
      first.headers['Authorization'] = 'Bearer $token';
    }
    var response = await client.send(first);
    var hops = 0;
    while (response.isRedirect && hops < 5) {
      final location = response.headers['location'];
      if (location == null) break;
      // Drain the redirect body so the connection can be reused.
      await response.stream.drain<void>();
      final next = Uri.parse(asset.downloadUrl).resolve(location);
      response = await client.send(
        http.Request('GET', next)
          ..followRedirects = false
          ..headers['User-Agent'] = 'gratovo-toolbox-updater',
      );
      hops++;
    }
    return response;
  }

  /// Writes the apply script, launches it detached, and returns true if it
  /// started. The caller quits immediately afterwards — until this process
  /// exits, the script is sitting in its wait loop.
  ///
  /// [allowElevation] false refuses to prompt for admin rights, which is what
  /// an unattended patch install passes.
  Future<bool> install(
    String downloadedPath, {
    required UpdatePlan plan,
    bool allowElevation = true,
  }) async {
    if (!canSelfUpdate) return false;
    final elevate = !await canWriteTo(plan.targetDir);
    if (elevate && !allowElevation) {
      developer.log(
        'Skipping unattended install: ${plan.targetDir} needs admin rights, '
        'and a surprise UAC prompt is not an unattended install. The download '
        'is staged and will be applied on a manual Update.',
        name: 'gratovo.update',
        level: 800,
      );
      return false;
    }

    try {
      final scriptFile = File(
        '${File(downloadedPath).parent.path}${Platform.pathSeparator}'
        'apply_update.ps1',
      );
      await scriptFile.writeAsString(_applyScript);

      final args = <String>[
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptFile.path,
        '-ParentPid',
        '$pid',
        '-SourcePath',
        downloadedPath,
        '-Mode',
        plan.artifact == UpdateArtifact.installer ? 'installer' : 'archive',
        '-TargetDir',
        stripTrailingSeparators(plan.targetDir),
        '-CurrentExe',
        Platform.resolvedExecutable,
        if (elevate) '-Elevated',
      ];

      if (elevate) {
        // Relaunching through Start-Process -Verb RunAs is what raises the UAC
        // prompt. Windows PowerShell 5.1 joins an -ArgumentList array with
        // spaces and no quoting, so a path with a space in it would arrive as
        // two arguments; the list is pre-joined into ONE quoted command line
        // instead. The outer shell is awaited, not detached: Start-Process
        // throws when the prompt is declined, and that has to come back here
        // as "not started" rather than the app quitting on a promise.
        final commandLine = args.map(quoteForCommandLine).join(' ');
        final outer = await Process.run(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            r"$ErrorActionPreference = 'Stop'; "
                'Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden '
                "-ArgumentList '${commandLine.replaceAll("'", "''")}'",
          ],
        );
        if (outer.exitCode != 0) {
          developer.log(
            'Elevation was declined or failed (exit ${outer.exitCode}); '
            'the install is unchanged. ${outer.stderr}',
            name: 'gratovo.update',
            level: 800,
          );
          return false;
        }
      } else {
        await Process.start(
          'powershell.exe',
          args,
          mode: ProcessStartMode.detached,
        );
      }
      return true;
    } catch (error, stackTrace) {
      developer.log(
        'Could not start the update script; the install is unchanged.',
        name: 'gratovo.update',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      return false;
    }
  }

  /// Quits so the apply script's `Wait-Process` can return and the files this
  /// process holds open become writable.
  ///
  /// `exit(0)` rather than closing the window: the script is already running
  /// and counting down its wait, so the one thing that must not happen is the
  /// app staying alive because something declined to close.
  /// `UpdateController` drains the sync engine before calling this, which is
  /// where in-flight writes get their chance to land.
  Future<void> quitForUpdate() async => exit(0);

  /// Double-quotes one argument for a Windows command line, escaping embedded
  /// quotes the way CommandLineToArgvW expects. Visible for tests.
  static String quoteForCommandLine(String arg) {
    if (arg.isEmpty) return '""';
    final needsQuotes = arg.contains(' ') || arg.contains('"');
    if (!needsQuotes) return arg;
    return '"${arg.replaceAll('"', r'\"')}"';
  }

  /// A directory ending in a separator, once double-quoted, reads as an
  /// escaped quote to the command-line parser (`"C:\x\"`), which swallows
  /// the quote and breaks every argument after it. Visible for tests.
  static String stripTrailingSeparators(String dir) {
    var out = dir;
    while (out.length > 3 && (out.endsWith(r'\') || out.endsWith('/'))) {
      out = out.substring(0, out.length - 1);
    }
    return out;
  }
}

/// The out-of-process apply.
///
/// Two modes. `installer` hands the .exe to Inno Setup with the target
/// directory and lets it do the registration, shortcuts and uninstall entry
/// that unzipping cannot. `archive` expands the .zip to temp, confirms the
/// app .exe is really in there, and only then copies it into place.
///
/// Both end by launching whatever is now at the target, and by relaunching
/// the old build if anything went wrong — a failed update should cost a
/// restart, not a working app.
const _applyScript = r"""
param(
  [Parameter(Mandatory=$true)][int]$ParentPid,
  [Parameter(Mandatory=$true)][string]$SourcePath,
  [Parameter(Mandatory=$true)][ValidateSet('installer','archive')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$TargetDir,
  [Parameter(Mandatory=$true)][string]$CurrentExe,
  [switch]$Elevated
)

$ErrorActionPreference = 'Stop'
$logDir = Split-Path $SourcePath -Parent
$log = Join-Path $logDir 'apply_update.log'
function Log($m) {
  "$((Get-Date).ToString('s'))  $m" | Out-File -FilePath $log -Append -Encoding utf8
}

$exeName = Split-Path $CurrentExe -Leaf
$launched = $false

# Launch the new build if it is there, otherwise put the old one back. Called
# on every exit path, so a failed update costs a restart rather than an app.
function LaunchBest {
  if ($script:launched) { return }
  $script:launched = $true
  $new = Join-Path $TargetDir $exeName
  if (Test-Path $new) {
    try { Start-Process -FilePath $new -WorkingDirectory $TargetDir; return }
    catch { Log "launch of $new failed: $_" }
  }
  try { Start-Process -FilePath $CurrentExe } catch { Log "relaunch failed: $_" }
}

try {
  Log "waiting for pid $ParentPid to exit ($Mode -> $TargetDir)"
  try { Wait-Process -Id $ParentPid -Timeout 120 -ErrorAction Stop } catch { Log "wait ended: $_" }
  # File locks outlive the process by a moment on Windows.
  Start-Sleep -Milliseconds 1500

  if ($Mode -eq 'installer') {
    # Inno Setup's own silent switches. /DIR is what puts a minor or major
    # release in its own folder instead of over the previous one.
    # /VERYSILENT suppresses the wizard entirely; the postinstall "launch"
    # task carries skipifsilent, so LaunchBest does the starting.
    # A silent run never sees the per-user / all-users dialog, and without
    # being told, Inno falls back to its admin default: a UAC prompt in the
    # middle of an unattended patch, and a per-user install re-registered
    # as all-users. Whether the app had to elevate to reach $TargetDir is
    # exactly which kind of install this is.
    $scope = if ($Elevated) { '/ALLUSERS' } else { '/CURRENTUSER' }
    $innoArgs = @(
      '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOCANCEL', $scope,
      "/DIR=`"$TargetDir`"",
      "/LOG=`"$(Join-Path $logDir 'inno.log')`""
    )
    Log "running installer: $SourcePath $($innoArgs -join ' ')"
    $proc = Start-Process -FilePath $SourcePath -ArgumentList $innoArgs -Wait -PassThru
    if ($proc.ExitCode -ne 0) { throw "installer exited with $($proc.ExitCode)" }
    Log "installer finished"
  }
  else {
    $stage = Join-Path $logDir 'staged'
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    Log "expanding $SourcePath"
    Expand-Archive -Path $SourcePath -DestinationPath $stage -Force

    # build_windows.ps1 zips the staged folder itself, so the archive holds one
    # top-level gratovo_toolbox-<version>-windows-x64\ directory rather than
    # the files loose at the root.
    $source = Get-ChildItem -Path $stage -Directory |
      Where-Object { Test-Path (Join-Path $_.FullName $exeName) } |
      Select-Object -First 1
    if (-not $source) {
      # Tolerates a future archive that drops the wrapping folder.
      if (Test-Path (Join-Path $stage $exeName)) { $source = Get-Item $stage }
    }
    if (-not $source) { throw "no $exeName inside the archive; leaving the install alone" }

    if (-not (Test-Path $TargetDir)) { New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null }
    Log "copying $($source.FullName) -> $TargetDir"
    # /E not /MIR: mirroring would delete anything in the target folder that
    # the archive does not carry, and that folder is not exclusively ours.
    # /R:3 /W:2 rides out a file lock that outlasted the wait above.
    $null = robocopy $source.FullName $TargetDir /E /R:3 /W:2 /NFL /NDL /NJH /NJS
    # robocopy exit codes below 8 mean success (files copied, or nothing to do).
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE" }
    Log "update applied"
  }
}
catch {
  Log "update failed: $_"
}
finally {
  LaunchBest
  try {
    Remove-Item -Recurse -Force (Join-Path $logDir 'staged') -ErrorAction SilentlyContinue
    Remove-Item -Force $SourcePath -ErrorAction SilentlyContinue
  } catch { }
}
""";
