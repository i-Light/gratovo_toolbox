# My apps — how to add an app

Settings → **My apps** lists your other apps. Each row offers only what its entry says is true:

| What the entry has | What the row shows |
|---|---|
| `windows.exe` and the app is installed | **Open** (Windows build) + "Installed on this computer" |
| `windows.exe` + `github`, not installed | **Install**: downloads the latest release's `…setup.exe` and starts it; **Open** appears once it is installed |
| `android.playStore: true` | **Google Play** (on a PC it opens the store page in the browser, which can send the install to a phone) |
| `android.apk: true` + `github` | **Download APK** (only when this app runs on Android) |
| `github` | a GitHub icon that opens the repository |

The list is `assets/my_apps.json`. It is bundled with the app, so a change reaches everyone with the next build/update and
works offline.

## Adding an app (3 steps)

1. Add an entry to `assets/my_apps.json` (copy one of the examples below).
2. Run `flutter test test/core/my_apps` — it reads the real file and fails on a typo, a missing `id`, a bad repo name or a
   duplicate id. (The app also shows unreadable entries in red in the My apps card instead of hiding them.)
3. Build as usual.

## The entry

```json
{
  "id": "dhikr_reminder",
  "name": "Dhikr Reminder",
  "description": { "en": "Gentle dhikr reminders.", "ar": "تذكيرات بالأذكار." },
  "icon": "mosque",
  "github":  { "repo": "i-Light/dhikr_reminder", "private": false },
  "windows": { "exe": ["%LOCALAPPDATA%/Programs/Dhikr Reminder/dhikr_reminder.exe"] },
  "android": { "package": "com.gratovo.dhikr_reminder", "playStore": false, "apk": false }
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique, never shown. Use the project's folder name. |
| `name` | no | Text, or `{"en": "...", "ar": "..."}`. Defaults to the id. |
| `description` | no | Text, or `{"en": "...", "ar": "..."}`. |
| `icon` | no | One of `apps` `mosque` `book` `calendar` `chat` `music` `game` `tools` `school` `heart` `alarm` `notifications`. |
| `github.repo` | with `github` | `owner/name`. |
| `github.private` | no | `true` for a private repository (see below). Default `false`. |
| `windows.exe` | no | One path or a list; the first that exists counts as "installed". `%VAR%` is expanded (`%LOCALAPPDATA%`, `%ProgramFiles%`, …). Use forward slashes — no JSON escaping needed. |
| `android.package` | with `android` | The application id (`applicationId` in `android/app/build.gradle(.kts)`). |
| `android.playStore` | no | `true` once the app is on Google Play. |
| `android.apk` | no | `true` if the GitHub release carries an `.apk`. |

Every section is optional: a Play-only app has just `android`; a Windows tool with no repository has just `windows`.

## What the release must look like

The Install and Download APK buttons read the repository's **latest** published release (not drafts or pre-releases):

- the Windows installer is the asset whose name ends in **`setup.exe`** (Inno Setup's `<app>-<version>-setup.exe`, like
  Gratovo's own releases);
- the Android package is the asset whose name ends in **`.apk`**.

If the latest release has no such file, the button opens the release page instead and says why.

Where did it install? Look in *Settings → Apps → Installed apps* or in the registry
(`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` → `InstallLocation`). Inno Setup's per-user default is
`%LOCALAPPDATA%/Programs/<AppName>/`.

## Private repositories

A private repository is read with the GitHub sign-in of **this** app (Settings → Accounts → GitHub). That account must have
access to the repository. The shared token compiled into Gratovo builds is scoped to `i-Light/gratovo_code` only, so for
private apps either:

- sign in under Accounts → GitHub with your own account on the machines that should install it, or
- add the other repositories to the shared fine-grained token (read-only *Contents* on each) before building.

A public repository is always read without a token, so an expired sign-in never blocks it.

On Android, a private repository's APK opens the release page in the browser (the browser's own GitHub session applies).

## Examples

Public Windows app on GitHub:

```json
{ "id": "timer", "name": "Timer", "icon": "alarm",
  "github": { "repo": "i-Light/timer" },
  "windows": { "exe": "%LOCALAPPDATA%/Programs/Timer/timer.exe" } }
```

Private repository, also on Google Play:

```json
{ "id": "notes", "name": { "en": "Notes", "ar": "ملاحظات" }, "icon": "book",
  "github": { "repo": "i-Light/notes", "private": true },
  "windows": { "exe": "%LOCALAPPDATA%/Programs/Notes/notes.exe" },
  "android": { "package": "com.gratovo.notes", "playStore": true } }
```

Android-only, sideloaded from GitHub releases:

```json
{ "id": "tracker", "name": "Tracker",
  "github": { "repo": "i-Light/tracker" },
  "android": { "package": "com.gratovo.tracker", "apk": true } }
```

When dhikr_reminder reaches Google Play, change its `"playStore": false` to `true`.
