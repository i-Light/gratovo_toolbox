# gratovo_toolbox

Gratovo IMA ToolBox — the internal sourcing, outreach, and deal-management app
for Gratovo's influencer-marketing brokerage. Flutter, with Windows desktop as
the primary target.

## Running it during development

```powershell
flutter pub get
flutter run -d windows
```

The Supabase URL and anon key are compiled in (see
[lib/core/config/supabase_config.dart](lib/core/config/supabase_config.dart))
and are also overridable at runtime from Settings → Account → Advanced, so a
normal build needs no environment setup. Backend details live in
[backend/SETUP.md](backend/SETUP.md). The layout of the whole repository is in
[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md); what each release changed is in
[CHANGELOG.md](CHANGELOG.md).

### Tests

Three suites, and [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs
all of them on every push to `main` and every pull request:

```powershell
flutter analyze --fatal-infos; flutter test   # the app
cd pipeline; python -m pytest                 # the Python pipeline
cd backend/tests; ./run.sh                    # the schema + RLS, needs Docker
```

## Exporting the Windows .exe

Double-click **`build_windows.bat`** in the repo root, or run:

```powershell
.\scripts\build_windows.ps1
```

That builds the release app and stages it under `dist/`:

```
dist/
  gratovo_toolbox-1.2.2-windows-x64/      <- the app folder
    gratovo_toolbox.exe                   <- double-click this
    *.dll, data/, README.txt
  gratovo_toolbox-1.2.2-windows-x64.zip   <- send this to a teammate
```

**The .exe is not standalone.** Flutter's Windows output is an .exe plus the
DLLs and `data/` folder beside it; moving the .exe out of the folder gives you
a binary that fails on launch. Ship the whole folder (or the .zip) and make a
shortcut rather than a copy. That is the whole reason this script exists — it
stages the complete bundle under a versioned name so the wrong half never gets
sent.

Useful flags:

| Flag | What it does |
| --- | --- |
| `-Clean` | `flutter clean` first — for when a build fails for no visible reason, or after an SDK upgrade |
| `-Run` | Launch the staged .exe when the build finishes |
| `-NoZip` | Stage the folder, skip the .zip |
| `-Installer` | Also produce `dist/gratovo_toolbox-<version>-setup.exe` (needs [Inno Setup 6](https://jrsoftware.org/isdl.php); skipped with a warning if it is not installed) |
| `-Define K=V,...` | Extra `--dart-define`s, e.g. `-Define SUPABASE_URL=https://other.supabase.co,LOCAL_MIRROR=off` |
| `-OutDir <path>` | Stage somewhere other than `dist/` |

The version in the folder and zip names comes from `version:` in
`pubspec.yaml` — bump it there before cutting a build worth naming.

`dist/` is gitignored; these are artifacts, not source.

### Requirements

Flutter ≥ 3.38 (`sqlite3` needs native assets, see the note in
[pubspec.yaml](pubspec.yaml)) and Visual Studio with the "Desktop development
with C++" workload. `flutter doctor` will say so if either is missing.
