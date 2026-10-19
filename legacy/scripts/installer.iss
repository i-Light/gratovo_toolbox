; Inno Setup script for the Gratovo IMA ToolBox Windows build.
;
; Not invoked directly -- scripts/build_windows.ps1 -Installer calls ISCC with
; the three defines below already filled in:
;
;   ISCC.exe /DAppVersion=0.1.0 /DSourceDir=...\dist\gratovo_toolbox-0.1.0-windows-x64 ^
;            /DOutputDir=...\dist scripts\installer.iss
;
; Requires Inno Setup 6 (https://jrsoftware.org/isdl.php). The .zip that the
; build script always produces is the no-dependency alternative; this exists
; for people who would rather get a normal Start-menu entry and an uninstaller.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #error SourceDir must be defined (the staged dist\ folder to package)
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#define AppName "Gratovo IMA ToolBox"
#define AppExe "gratovo_toolbox.exe"
#define AppPublisher "Gratovo"

[Setup]
; A stable GUID: this is what lets a new version upgrade an existing install
; in place instead of piling up side-by-side entries. Never change it.
AppId={{7B2C4E1A-9F3D-4A56-8C1B-2D5E6F7A8B90}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\Gratovo IMA ToolBox
DefaultGroupName=Gratovo
UninstallDisplayIcon={app}\{#AppExe}
OutputDir={#OutputDir}
OutputBaseFilename=gratovo_toolbox-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Per-user install by default, so no admin prompt is needed to hand this to a
; teammate; the wizard still offers an all-users install where allowed.
; `lowest` is what makes per-user the DEFAULT -- without it the setting is
; `admin`, and a silent run (the in-app updater) that names no scope raises
; UAC for a per-user install. The updater also passes /CURRENTUSER or
; /ALLUSERS explicitly, matching whichever kind of install it found.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; The whole staged folder: the .exe alone will not run. That now includes
; pipeline\ (the Python scraper), pyruntime\ (the interpreter it runs on --
; the machines this is installed on have no Python of their own) and
; pipeline_data_seed\ (the .env / settings.json the app copies into
; %LOCALAPPDATA% on first launch). recursesubdirs is what carries all three;
; nothing here has to name them.
;
; Nothing writable is installed here, deliberately: the pipeline database, the
; email library and each person's settings live under
; %LOCALAPPDATA%\Gratovo IMA ToolBox\data instead, so ignoreversion cannot
; reset them on an upgrade and an uninstall cannot take them with it.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[UninstallDelete]
; Python writes __pycache__ folders beside the scripts it runs, so these two
; end up holding files the installer never created and would otherwise leave
; behind. Neither holds anything of the team's -- see [Files].
Type: filesandordirs; Name: "{app}\pipeline"
Type: filesandordirs; Name: "{app}\pyruntime"

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
