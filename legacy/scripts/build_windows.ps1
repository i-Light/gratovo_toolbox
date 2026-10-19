<#
.SYNOPSIS
    Builds the Gratovo IMA ToolBox Windows desktop app and stages a
    ready-to-hand-over folder (and .zip) under dist/.

.DESCRIPTION
    `flutter build windows --release` leaves its output in
    build/windows/x64/runner/Release/, which is easy to mistake for "just the
    .exe" -- it is not. The .exe needs the DLLs and the data/ folder sitting
    next to it, so copying gratovo_toolbox.exe on its own produces a binary
    that dies on launch. This script builds, then stages the WHOLE bundle
    under a versioned name and zips it, so what gets sent to a teammate is
    always the complete thing.

    "The complete thing" includes three folders Flutter does not build, and
    without which the app installs fine and then cannot run a single search:

      pipeline\           the Python pipeline itself, found by the app beside
                          the .exe (ScraperProcess.resolvePaths)
      pyruntime\          an embeddable CPython with the pipeline's
                          dependencies vendored in, because the machines this
                          gets installed on have no Python of their own
      pipeline_data_seed\ the .env / settings.json / email library an install
                          copies into %LOCALAPPDATA% on first launch

    The Supabase URL / anon key are compiled into the app by default (see
    lib/core/config/supabase_config.dart), so a normal build needs no secrets
    and no extra flags.

.PARAMETER Clean
    Run `flutter clean` first. Slower, but the right call when a build starts
    failing for no visible reason, or after a Flutter SDK upgrade.

.PARAMETER NoZip
    Stage the folder but skip the .zip.

.PARAMETER Installer
    Additionally build a single-file setup .exe with Inno Setup (needs ISCC on
    PATH or installed in the usual Program Files location -- see
    scripts/installer.iss). Skipped with a warning if Inno Setup is missing.

.PARAMETER SkipPythonRuntime
    Do not bundle a Python interpreter. Saves ~50 MB and the one network
    download this script makes, at the cost of searches only working on
    machines that already have Python and pipeline\requirements.txt.

.PARAMETER PythonVersion
    Which CPython embeddable build to bundle. Defaults to 3.12.10.

.PARAMETER OutDir
    Where to stage. Defaults to dist/ in the repo root.

.PARAMETER Define
    Extra --dart-define values, e.g.
        -Define SUPABASE_URL=https://other.supabase.co,LOCAL_MIRROR=off

.PARAMETER Run
    Launch the staged .exe when the build succeeds.

.PARAMETER NoAutoRelease
    Skip scripts/auto_version.ps1. Every build otherwise starts by bumping
    pubspec.yaml's Patch or Minor version from the commit messages since the
    last release tag (see that script's header for the rule) and, if the
    build succeeds, commits + tags + pushes it -- which triggers
    .github/workflows/release.yml and publishes a GitHub Release. If the bump
    can't happen -- dirty working tree, no tag yet, or no commits since the
    last tag -- the build stops before doing anything and asks you to either
    resolve that or re-run with this switch. So for a plain local build that
    isn't a release, pass -NoAutoRelease.

.PARAMETER KeepOldBuilds
    By default a successful build prunes dist\ down to just what it produced
    -- the staged folder, its .zip and (with -Installer) the setup .exe --
    deleting every older gratovo_toolbox-* folder, .zip and -setup.exe.
    Anything in dist\ without that prefix is never touched. Pass this to keep
    the older bundles.

.PARAMETER SkipBuild
    Skip `flutter build windows` and everything that depends on its output --
    staging, the .zip, the installer, pruning. Nothing is produced under
    dist\. Only useful together with auto-release (i.e. without
    -NoAutoRelease): .github/workflows/release.yml does the real Windows
    build on its own runner once the tag is pushed, so this bumps, commits,
    tags and pushes without making you wait through a local build first.

.EXAMPLE
    .\scripts\build_windows.ps1

.EXAMPLE
    .\scripts\build_windows.ps1 -Clean -Installer

.EXAMPLE
    .\scripts\build_windows.ps1 -NoAutoRelease
    # Local build only -- no version bump, no tag, no push.
#>
[CmdletBinding()]
param(
    [switch]$Clean,
    [switch]$NoZip,
    [switch]$Installer,
    [switch]$SkipPythonRuntime,
    [string]$PythonVersion = '3.12.10',
    [string]$OutDir,
    [string[]]$Define,
    [switch]$Run,
    [switch]$NoAutoRelease,
    [switch]$KeepOldBuilds,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

# Repo root is the parent of scripts/, so this works from any working directory.
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot 'dist' }

function Write-Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }
function Write-Ok($message)   { Write-Host "    $message" -ForegroundColor Green }
function Write-Warn2($message) { Write-Host "    $message" -ForegroundColor Yellow }

# --- Preflight -------------------------------------------------------------

if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
    throw "flutter was not found on PATH. Install the Flutter SDK and reopen the terminal."
}

# --- Auto-release ------------------------------------------------------------

# Bumps pubspec.yaml's version from the commits since the last release tag
# (see auto_version.ps1's header). Runs before the version is read below so
# the staged folder/zip/installer are named after the new version, and a
# no-op result (nothing new to release) leaves pubspec.yaml untouched.
$autoRelease = [PSCustomObject]@{ Bumped = $false }
if (-not $NoAutoRelease) {
    Write-Step 'Checking for an automatic version bump'
    $autoRelease = & (Join-Path $PSScriptRoot 'auto_version.ps1')

    # auto_version.ps1 used to skip silently whenever it couldn't bump (dirty
    # tree, no tag yet, no new commits), which produced a local build that
    # quietly published nothing. Stop instead and make the caller choose.
    if (-not $autoRelease.Bumped) {
        throw @"
Automatic release skipped: $($autoRelease.Reason).
Nothing was built. Pick one and run again:
  * resolve it (commit/stash changes, create the first tag, or add a commit since the last tag), then re-run to bump the version, tag it and publish a GitHub Release, or
  * run a local-only build with -NoAutoRelease (uncomment the "-NoAutoRelease" line in .vscode/tasks.json).
"@
    }
}

# The app version, straight out of pubspec.yaml ("0.1.0+1" -> "0.1.0"), so the
# staged folder and the zip are self-describing and two exports never collide.
$pubspec = Join-Path $RepoRoot 'pubspec.yaml'
$versionLine = Select-String -Path $pubspec -Pattern '^version:\s*(.+)$' | Select-Object -First 1
if ($versionLine) {
    $Version = ($versionLine.Matches[0].Groups[1].Value -split '\+')[0].Trim()
} else {
    $Version = '0.0.0'
    Write-Warn2 "No version: line in pubspec.yaml; falling back to $Version."
}

$AppName   = 'gratovo_toolbox'
$StageName = "$AppName-$Version-windows-x64"
$StageDir  = Join-Path $OutDir $StageName
$ZipPath   = Join-Path $OutDir "$StageName.zip"

Write-Step "Gratovo IMA ToolBox $Version - Windows release build"
Write-Ok "repo:   $RepoRoot"
Write-Ok "output: $OutDir"

if ($SkipBuild) {
    Write-Step 'Skipping the local build (-SkipBuild)'
    Write-Warn2 'Nothing staged under dist\ -- relying on .github/workflows/release.yml to build this tag.'
} else {

# --- Build -----------------------------------------------------------------

Push-Location $RepoRoot
try {
    if ($Clean) {
        Write-Step 'flutter clean'
        & flutter clean
        if ($LASTEXITCODE -ne 0) { throw "flutter clean failed (exit $LASTEXITCODE)." }
    }

    Write-Step 'flutter pub get'
    & flutter pub get
    if ($LASTEXITCODE -ne 0) { throw "flutter pub get failed (exit $LASTEXITCODE)." }

    # The .exe's icon is drawn from assets/images/logo.svg, the app's one logo.
    # The generated .ico is git-ignored, so it is made fresh on every build.
    Write-Step 'Generating the app icon from assets/images/logo.svg'
    & flutter test --no-pub tool/generate_app_icon.dart
    if ($LASTEXITCODE -ne 0) { throw "Generating the app icon failed (exit $LASTEXITCODE)." }

    $buildArgs = @('build', 'windows', '--release')

    # Automatically load .env if present in the repo root
    $envFile = Join-Path $RepoRoot 'data\.env'
    if (Test-Path $envFile) {
        $buildArgs += "--dart-define-from-file=$envFile"
        Write-Ok 'Loaded configuration from .env'
    }

    foreach ($d in $Define) {
        if ($d) { $buildArgs += "--dart-define=$d" }
    }

    # What the updater reads the private repo's releases with (see
    # lib/core/github/). Both are read from the environment so CI can supply
    # them and a local build can set them once, rather than every build having
    # to remember a -Define. An explicit -Define still wins.
    #
    # GRATOVO_GITHUB_TOKEN is the shared read-only token every copy of the app
    # carries. Without it -- and without the optional sign-in below -- the
    # built app can never find an update, because a private repository answers
    # an unauthenticated caller with a 404.
    #
    # It is NEVER echoed. A token printed into a build log is a token in every
    # CI artifact and every scrollback buffer, which is a far easier way to
    # leak it than pulling it out of the .exe. Only its presence is reported.
    if ($env:GRATOVO_GITHUB_TOKEN -and
        -not ($Define -join ',').Contains('GRATOVO_GITHUB_TOKEN')) {
        $buildArgs += "--dart-define=GRATOVO_GITHUB_TOKEN=$env:GRATOVO_GITHUB_TOKEN"
        Write-Ok 'Shared GitHub release token baked in (value not shown)'
    } else {
        Write-Warn2 'No GRATOVO_GITHUB_TOKEN -- this build will not find updates.'
    }

    # GRATOVO_GITHUB_CLIENT_ID is optional and enables the per-person sign-in,
    # which exists as the way out of a shared token that has expired. Unlike
    # the token it is not a secret: OAuth device flow has no client secret
    # precisely so the id can live in a desktop binary.
    if ($env:GRATOVO_GITHUB_CLIENT_ID -and
        -not ($Define -join ',').Contains('GRATOVO_GITHUB_CLIENT_ID')) {
        $buildArgs += "--dart-define=GRATOVO_GITHUB_CLIENT_ID=$env:GRATOVO_GITHUB_CLIENT_ID"
        Write-Ok 'GitHub client id picked up from the environment'
    }

    # Redacted for printing only: $buildArgs itself still carries the real
    # values. Without this the shared token would be echoed in full on every
    # build, including into CI logs.
    $shownArgs = $buildArgs | ForEach-Object {
        if ($_ -match '^--dart-define=([^=]*(TOKEN|KEY|SECRET)[^=]*)=') {
            "--dart-define=$($Matches[1])=***"
        } else { $_ }
    }
    Write-Step "flutter $($shownArgs -join ' ')"
    & flutter @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "flutter build windows failed (exit $LASTEXITCODE)." }
}
finally {
    Pop-Location
}

# --- Locate the bundle -----------------------------------------------------

# x64 on every machine we build on today; arm64 is checked too so an ARM
# Windows box does not silently produce "build succeeded, nothing staged".
$candidates = @(
    (Join-Path $RepoRoot 'build\windows\x64\runner\Release'),
    (Join-Path $RepoRoot 'build\windows\arm64\runner\Release')
)
$ReleaseDir = $candidates |
    Where-Object { Test-Path (Join-Path $_ "$AppName.exe") } |
    Select-Object -First 1
if (-not $ReleaseDir) {
    throw "The build reported success but no $AppName.exe was found under build\windows\*\runner\Release."
}

# --- Stage -----------------------------------------------------------------

Write-Step "Staging to $StageDir"
if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

# Everything in Release\, not just the .exe: the DLLs and data\ beside it are
# part of the app.
Copy-Item -Path (Join-Path $ReleaseDir '*') -Destination $StageDir -Recurse -Force

# `flutter build windows --release` compiles ahead of time: the program is
# data\app.so, and data\flutter_assets\kernel_blob.bin is the *debug* build's
# artefact. Flutter does not clean stale files out of Release\, so a release
# build run in a folder a debug build touched leaves a ~90 MB kernel_blob.bin
# behind -- and it went straight into the .zip and the installer, roughly
# doubling both for a file the release .exe never opens. Removed only when
# app.so proves this really is an AOT build.
$aotBinary   = Join-Path $StageDir 'data\app.so'
$debugKernel = Join-Path $StageDir 'data\flutter_assets\kernel_blob.bin'
if ((Test-Path $aotBinary) -and (Test-Path $debugKernel)) {
    $staleMb = [math]::Round(((Get-Item $debugKernel).Length / 1MB), 1)
    Remove-Item -Force $debugKernel
    Write-Ok "dropped a stale debug kernel_blob.bin ($staleMb MB) left in Release\"
}

# --- Stage the Python pipeline --------------------------------------------

# The .exe cannot run a search without these. The app finds pipeline\ beside
# the executable (ScraperProcess.resolvePaths); leaving it out is what made an
# installed build fail every search with "The directory name is invalid".
Write-Step 'Staging pipeline\'
$pipelineSrc = Join-Path $RepoRoot 'pipeline'
$pipelineDst = Join-Path $StageDir 'pipeline'
New-Item -ItemType Directory -Force -Path $pipelineDst | Out-Null
# __pycache__ is this build machine's bytecode for this build machine's
# interpreter, and tests\ is for developing the pipeline, not running it --
# as is the extension's jsdom suite (gemini_extension\test, ~14 MB once its
# node_modules is installed), and whatever a local pytest or build left
# behind. Those are untracked, so a CI checkout never has them; a local build
# used to ship them all. The extension itself and its tools\ (the app builds
# the Firefox add-on from them at runtime) are staged.
& robocopy $pipelineSrc $pipelineDst /E /NFL /NDL /NJH /NJS /NP /XD '__pycache__' 'tests' 'node_modules' '.pytest_cache' (Join-Path $pipelineSrc 'gemini_extension\test') (Join-Path $pipelineSrc 'build') | Out-Null
# robocopy exits 0-7 for success (1 = files copied, 2 = extras, ...); only 8+
# is a real failure. $LASTEXITCODE has to be checked against that, not against
# zero, or every successful copy looks like an error.
if ($LASTEXITCODE -ge 8) { throw "Copying pipeline\ failed (robocopy exit $LASTEXITCODE)." }
$global:LASTEXITCODE = 0

# --- Stage the data seed ---------------------------------------------------

# NOT staged as data\: the Flutter engine already owns <app>\data (app.so,
# flutter_assets, icudtl.dat). The app copies these into a writable per-user
# folder on first launch -- %LOCALAPPDATA%\Gratovo IMA ToolBox\data -- and
# never overwrites what is already there, so an upgrade cannot reset somebody's
# settings. See ScraperProcess.ensureDataDir.
#
# Only the small shared files. gratovo.db is deliberately absent: the app's
# first background pull bootstraps it from the R2 catalog anyway, and shipping
# a snapshot would hand every teammate a copy that is stale the day it is
# built.
Write-Step 'Staging pipeline_data_seed\'
$seedDst = Join-Path $StageDir 'pipeline_data_seed'
New-Item -ItemType Directory -Force -Path $seedDst | Out-Null
# reset_manifest.json rides along here rather than in data\ proper: the app
# reads it straight from pipeline_data_seed\ every launch (see
# ScraperProcess.applyPendingResets), so a build that retires a stale database
# takes effect without _copyMissing's copy-if-absent ever getting in the way.
$seedFiles = @('.env.example', 'settings.json', 'reset_manifest.json')
foreach ($name in $seedFiles) {
    $src = Join-Path $RepoRoot "data\$name"
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $seedDst $name) -Force
    } else {
        Write-Warn2 "data\$name is missing; the install will start without it."
    }
}

# The .env is what carries the team's keys to every install: the YouTube key
# and the four R2 values (this repo's data\.env is the source of truth -- it
# is tracked on purpose so the CI release can build from a clean checkout).
# Two kinds of line must NOT travel with it and are blanked here as a
# backstop; their real values live in data\.env.local, which is gitignored
# and never staged:
#   * SUPABASE_URL / SUPABASE_SERVICE_KEY / R2_API_TOKEN / AWS_IAM_* -- the
#     service_role key bypasses every access rule and the IAM pair can
#     provision AWS resources; both exist only for one-off tooling on a
#     trusted machine and must never sit inside an installed app.
#   * WORKER_NAME -- per machine. Left blank, each install defaults to its
#     own hostname, which is what names its prefix in the R2 catalog.
# On an existing install the app MERGES this file into the .env already there
# (keys it lacks are added, nothing is overwritten -- see env_merge.dart), so
# an upgrade hands out the R2 keys without touching anybody's own settings.
$envSrc = Join-Path $RepoRoot 'data\.env'
if (Test-Path $envSrc) {
    $neverShipped = @('SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'R2_API_TOKEN',
                      'AWS_IAM_ACCESS_KEY_ID', 'AWS_IAM_SECRET_ACCESS_KEY', 'WORKER_NAME')
    $envLines = Get-Content -Path $envSrc -Encoding utf8 | ForEach-Object {
        $line = $_
        foreach ($key in $neverShipped) {
            if ($line -match "^\s*$key\s*=") { $line = "$key="; break }
        }
        $line
    }
    Set-Content -Path (Join-Path $seedDst '.env') -Value $envLines -Encoding utf8
    $shipped = @($envLines | Where-Object { $_ -match '^\s*R2_(ACCOUNT_ID|ACCESS_KEY_ID|SECRET_ACCESS_KEY|BUCKET)\s*=\s*\S' }).Count
    if ($shipped -eq 4) {
        Write-Ok '.env staged with the R2 keys; service key and worker name blanked'
    } else {
        Write-Warn2 ".env staged but only $shipped of the 4 R2_* values are set in data\.env -- installs will run local-only."
    }
} else {
    Write-Warn2 'data\.env is missing; the install will start without it.'
}

# The Email Critique Library is seeded inside database\, not beside it. The
# app's _copyMissing walks folders, so a file staged at
# pipeline_data_seed\database\email_library.db lands at
# <dataDir>\database\email_library.db -- the one place every reader of it,
# on both sides of the language boundary, now looks.
$seedDbDst = Join-Path $seedDst 'database'
New-Item -ItemType Directory -Force -Path $seedDbDst | Out-Null
$seedDbSrc = Join-Path $RepoRoot 'data\database\email_library.db'
if (Test-Path $seedDbSrc) {
    Copy-Item -Path $seedDbSrc -Destination (Join-Path $seedDbDst 'email_library.db') -Force
} else {
    Write-Warn2 'data\database\email_library.db is missing; the install will start without it.'
}
foreach ($name in @('gemini skills', 'found_channels_data')) {
    $src = Join-Path $RepoRoot "data\$name"
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $seedDst -Recurse -Force
    }
}

# --- Stage the Python runtime ----------------------------------------------

# The machines this gets installed on do not have Python. Without an
# interpreter beside the .exe, pipeline\ is inert and every search dies with
# "The system cannot find the file specified" instead -- a different error
# with the same outcome. python.org's embeddable distribution is a ~12 MB zip
# that needs no installer and no registry entry, which is exactly the shape
# this needs. ScraperProcess.resolveInterpreter prefers it over PATH whenever
# Settings -> Search Tuning is left at its default.
if ($SkipPythonRuntime) {
    Write-Step 'Skipping the bundled Python runtime (-SkipPythonRuntime)'
    Write-Warn2 'Searches will only work on machines that already have Python + pipeline\requirements.txt.'
} else {
    Write-Step "Staging pyruntime\ (CPython $PythonVersion, embeddable)"

    $shortVersion = ($PythonVersion -split '\.')[0..1] -join '.'
    $tag          = ($PythonVersion -split '\.')[0..1] -join ''   # 3.12.10 -> 312
    $zipName      = "python-$PythonVersion-embed-amd64.zip"
    $cacheDir     = Join-Path $RepoRoot 'build\pyruntime-cache'
    $cachedZip    = Join-Path $cacheDir $zipName

    New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
    if (-not (Test-Path $cachedZip)) {
        $url = "https://www.python.org/ftp/python/$PythonVersion/$zipName"
        Write-Ok "downloading $url"
        # The only step in this script that needs the network. Cached under
        # build\ so a rebuild is offline.
        $progressBefore = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'   # ~10x faster Invoke-WebRequest
        try {
            Invoke-WebRequest -Uri $url -OutFile $cachedZip -UseBasicParsing
        } finally {
            $ProgressPreference = $progressBefore
        }
    } else {
        Write-Ok "using cached $zipName"
    }

    $runtimeDst = Join-Path $StageDir 'pyruntime'
    Expand-Archive -Path $cachedZip -DestinationPath $runtimeDst -Force

    # The embeddable distribution ships with site-packages switched OFF -- it
    # is meant for apps that vendor their own import path. Without these two
    # lines the packages installed just below are on disk and invisible, and
    # `import googleapiclient` fails at runtime with the folder right there.
    $pthPath = Join-Path $runtimeDst "python$tag._pth"
    if (-not (Test-Path $pthPath)) { throw "The embeddable zip had no python$tag._pth; is $PythonVersion right?" }
    Set-Content -Path $pthPath -Encoding ascii -Value @(
        "python$tag.zip",
        '.',
        'Lib\site-packages',
        '',
        'import site'
    )

    # Installed with THIS machine's pip but resolved for the *bundled*
    # interpreter: --python-version/--platform/--implementation pick the wheels
    # the embedded 3.12 can import, not the ones the build machine's own Python
    # happens to be. --only-binary is required by pip for that to be honoured,
    # and is what it should be anyway -- there is no compiler on the far end.
    $pip = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pip) { throw "python was not found on PATH; it is needed to vendor the pipeline's dependencies. Rerun with -SkipPythonRuntime to build without them." }

    Write-Ok "installing pipeline\requirements.txt for cp$tag-win_amd64"
    & python -m pip install `
        --disable-pip-version-check --no-input --upgrade `
        --target (Join-Path $runtimeDst 'Lib\site-packages') `
        --platform win_amd64 --python-version $shortVersion `
        --implementation cp --only-binary=:all: `
        -r (Join-Path $pipelineSrc 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw "Vendoring the pipeline's dependencies failed (pip exit $LASTEXITCODE)." }

    # google-api-python-client ships a static discovery document for every
    # Google API there is -- 600 files and ~100 MB, which is more than the
    # entire rest of this build put together. The pipeline calls exactly one
    # of them (`build("youtube", "v3", ...)` in pipeline.py). The youtube ones
    # stay rather than being dropped too: with them present the client never
    # fetches a discovery document over the network, which is one less thing
    # that can fail on a machine behind a proxy.
    $docs = Join-Path $runtimeDst 'Lib\site-packages\googleapiclient\discovery_cache\documents'
    if (Test-Path $docs) {
        $before = @(Get-ChildItem -File $docs)
        $before | Where-Object { $_.Name -notlike 'youtube*' } | Remove-Item -Force
        $after = @(Get-ChildItem -File $docs)
        Write-Ok "trimmed Google discovery documents: $($before.Count) -> $($after.Count)"
    }

    # A smoke test, because "the app silently cannot search" is the failure
    # this whole block exists to prevent, and it is much cheaper to catch here
    # than on a teammate's machine.
    $runtimeExe = Join-Path $runtimeDst 'python.exe'
    & $runtimeExe -c "import sqlite3, ssl, requests; from googleapiclient.discovery import build; build('youtube', 'v3', developerKey='smoke-test')"
    if ($LASTEXITCODE -ne 0) { throw "The bundled runtime cannot import what the pipeline needs, or cannot build the YouTube client offline." }
    Write-Ok 'runtime imports and builds the YouTube client offline'

    # The Gemini bridge daemon, started the way the app starts it. This
    # runtime is isolated by its ._pth file, so `-m gemini_bridge` cannot
    # import the package -- which is how installed builds ended up never
    # seeing the browser extension. Its first line must say `listening`; the
    # empty stdin shuts it down straight after.
    $daemonOut = @('' | & $runtimeExe (Join-Path $pipelineDst 'run_gemini_daemon.py') daemon --port 0)
    if ($LASTEXITCODE -ne 0 -or "$($daemonOut | Select-Object -First 1)" -notmatch '"state":"listening"') {
        throw "The bundled runtime cannot start the Gemini bridge daemon (exit $LASTEXITCODE): $($daemonOut -join ' ')"
    }
    Write-Ok 'runtime starts the Gemini bridge daemon'
}

# A short note in the folder, so whoever receives it knows the .exe is not
# movable on its own.
$readme = @"
Gratovo IMA ToolBox $Version (Windows x64)

To run: double-click $AppName.exe in this folder.

Keep this folder together. The .exe needs the .dll files and the data\,
pipeline\, pyruntime\ and pipeline_data_seed\ folders that sit beside it --
copying the .exe somewhere on its own will not work. Make a shortcut to it
instead (right-click -> Send to -> Desktop).

There is no install step and no setup: the app talks to the team's Supabase
backend and the shared R2 bucket out of the box, and it brings its own Python
for the search pipeline, so nothing has to be installed for Search to work.
Sign in with your Gratovo account on first launch. The first launch after
this upgrade syncs this machine's channels with the team's bucket in the
background; the Settings page shows when it is done.

Your settings live in
  %LOCALAPPDATA%\Gratovo IMA ToolBox\data
and your email library and the pipeline's local database in
  %LOCALAPPDATA%\Gratovo IMA ToolBox\data\database
not in this folder, so replacing this folder with a newer build keeps them.
"@
Set-Content -Path (Join-Path $StageDir 'README.txt') -Value $readme -Encoding utf8

# --- Create a shortcut to the app data folder ---

# Must match `userDataDir()` in scraper_process_io.dart -- that is where the
# pipeline's settings, keywords.json and `database/` (gratovo.db, mailbox.db,
# email_library.db) actually live for an installed build, same folder the
# README above points to. `%APPDATA%\com.gratovo\gratovo_toolbox` is a
# different folder entirely (path_provider's getApplicationSupportDirectory,
# named from windows/runner/Runner.rc's CompanyName/ProductName) -- it holds
# the Supabase mirror db, the image cache and sync logs, not the pipeline's
# data, so a shortcut pointing there opened the wrong folder.
$shortcutPath = Join-Path $StageDir "Open Data Folder.lnk"
$dataFolder = Join-Path $env:LOCALAPPDATA 'Gratovo IMA ToolBox\data'

$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $dataFolder
$shortcut.WorkingDirectory = $dataFolder
$shortcut.Description = "Opens the Gratovo Toolbox saved data folder"
$shortcut.Save()
Write-Ok "created 'Open Data Folder.lnk' shortcut to $dataFolder"

$exePath = Join-Path $StageDir "$AppName.exe"
$files   = @(Get-ChildItem -Recurse -File $StageDir)
$sizeMb  = [math]::Round((($files | Measure-Object -Property Length -Sum).Sum / 1MB), 1)
Write-Ok "$($files.Count) files, $sizeMb MB"

# --- Zip -------------------------------------------------------------------

if (-not $NoZip) {
    Write-Step "Zipping to $ZipPath"
    if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
    Compress-Archive -Path $StageDir -DestinationPath $ZipPath -CompressionLevel Optimal
    $zipMb = [math]::Round(((Get-Item $ZipPath).Length / 1MB), 1)
    Write-Ok "$zipMb MB"
}

# --- Optional installer ----------------------------------------------------

if ($Installer) {
    Write-Step 'Building the setup .exe with Inno Setup'
    $iscc = Get-Command iscc -ErrorAction SilentlyContinue
    if ($iscc) {
        $isccPath = $iscc.Source
    } else {
        $isccPath = @(
            "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
            "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    }

    if (-not $isccPath) {
        Write-Warn2 'Inno Setup (ISCC.exe) not found - skipping the installer.'
        Write-Warn2 'Install it from https://jrsoftware.org/isdl.php, or just ship the .zip.'
    } else {
        $iss = Join-Path $PSScriptRoot 'installer.iss'
        & $isccPath "/DAppVersion=$Version" "/DSourceDir=$StageDir" "/DOutputDir=$OutDir" $iss
        if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed (exit $LASTEXITCODE)." }
        Write-Ok (Join-Path $OutDir "$AppName-$Version-setup.exe")
    }
}

# --- Prune older bundles from dist\ ---------------------------------------

# Left alone, dist\ accumulates a folder + .zip (+ installer) per version for
# ever. Reached only once this build's own artefacts are in place, so it is
# safe to drop the rest: every gratovo_toolbox-* entry that is not what we
# just produced. The "$AppName-" prefix keeps this away from anything else
# parked in dist\; -KeepOldBuilds skips it entirely.
if (-not $KeepOldBuilds) {
    Write-Step 'Pruning older builds from dist\'
    $keepNames = @(
        (Split-Path -Leaf $StageDir),
        (Split-Path -Leaf $ZipPath),
        "$AppName-$Version-setup.exe"
    )
    $pruned = 0
    Get-ChildItem -LiteralPath $OutDir -Filter "$AppName-*" -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notin $keepNames } |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force
            Write-Ok "removed $($_.Name)"
            $pruned++
        }
    if ($pruned -eq 0) { Write-Ok 'nothing to prune' }
}

} # end of the -SkipBuild guard opened above the Build section

# --- Publish the auto-release -----------------------------------------------

# Only reached if everything above succeeded -- a failed build never commits
# or tags the version bump auto_version.ps1 already wrote to pubspec.yaml.
if ($autoRelease.Bumped) {
    Write-Step "Publishing $($autoRelease.Version) ($($autoRelease.Part))"
    . (Join-Path $PSScriptRoot '_version_common.ps1')
    Publish-VersionTag $RepoRoot $autoRelease.ShortVersion $autoRelease.Version `
        "Release $($autoRelease.Version) [$($autoRelease.Part)]"
}

# --- Done ------------------------------------------------------------------

Write-Step 'Done'
if ($SkipBuild) {
    if ($Run) { Write-Warn2 '-Run has no effect with -SkipBuild -- nothing was built to launch.' }
} else {
    Write-Host "    App folder : $StageDir" -ForegroundColor Green
    Write-Host "    Executable : $exePath" -ForegroundColor Green
    if (-not $NoZip) { Write-Host "    Shareable  : $ZipPath" -ForegroundColor Green }

    if ($Run) {
        Write-Step 'Launching'
        Start-Process -FilePath $exePath -WorkingDirectory $StageDir
    }
}
