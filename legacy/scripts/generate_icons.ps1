<#
.SYNOPSIS
    Regenerates the app launcher icons (Android, iOS, Web) from
    assets/images/logo.svg.

.DESCRIPTION
    flutter_launcher_icons cannot read SVG directly (NoDecoderForImageFormatException).
    This script renders logo.svg to a high-resolution temporary PNG with
    sharp-cli (via npx), points flutter_launcher_icons.yaml at that PNG just
    for the run, then restores the yaml and deletes the temp PNG -- so the
    repo never gains a permanent duplicate raster copy of the logo.

    Windows is NOT handled here: the .exe's icon is drawn from logo.svg by
    tool/generate_app_icon.dart on every build (scripts/build_windows.ps1 runs
    it), so there is no Windows icon file to regenerate or keep in step.

.PARAMETER Size
    Pixel width/height of the temporary source PNG. Higher = crisper small
    icons (e.g. the Windows title bar) at the cost of a slower render.
    Defaults to 4096.

.EXAMPLE
    .\scripts\generate_icons.ps1

.EXAMPLE
    .\scripts\generate_icons.ps1 -Size 2048
#>
[CmdletBinding()]
param(
    [int]$Size = 4096
)

$ErrorActionPreference = 'Stop'

# Repo root is the parent of scripts/, so this works from any working directory.
$RepoRoot   = Split-Path -Parent $PSScriptRoot
$SvgPath    = Join-Path $RepoRoot 'assets\images\logo.svg'
$TempPng    = Join-Path $RepoRoot 'assets\images\.icon_source_temp.png'
$ConfigPath = Join-Path $RepoRoot 'flutter_launcher_icons.yaml'

function Write-Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }
function Write-Ok($message)   { Write-Host "    $message" -ForegroundColor Green }

if (-not (Test-Path $SvgPath)) {
    throw "$SvgPath not found."
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw "npx was not found on PATH. Install Node.js and reopen the terminal."
}

Write-Step "Rendering logo.svg to a ${Size}x${Size} PNG (sharp-cli via npx)"
& npx --yes sharp-cli -i $SvgPath -o $TempPng resize $Size $Size
if ($LASTEXITCODE -ne 0) { throw "sharp-cli failed to render the SVG (exit $LASTEXITCODE)." }
Write-Ok $TempPng

$originalConfig = Get-Content -Path $ConfigPath -Raw
try {
    Write-Step "Pointing flutter_launcher_icons.yaml at the temp PNG"
    $tempPngForwardSlash = $TempPng.Substring($RepoRoot.Length + 1) -replace '\\', '/'
    $updatedConfig = $originalConfig -replace 'image_path:\s*"[^"]*"', "image_path: `"$tempPngForwardSlash`""
    Set-Content -Path $ConfigPath -Value $updatedConfig -NoNewline

    Write-Step "Generating launcher icons (Android / iOS / Web)"
    Push-Location $RepoRoot
    try {
        & dart run flutter_launcher_icons
        if ($LASTEXITCODE -ne 0) { throw "flutter_launcher_icons failed (exit $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }

}
finally {
    Write-Step "Restoring flutter_launcher_icons.yaml and deleting the temp PNG"
    Set-Content -Path $ConfigPath -Value $originalConfig -NoNewline
    Remove-Item -Path $TempPng -Force -ErrorAction SilentlyContinue
    Write-Ok "restored"
}

Write-Step 'Done'
Write-Host "    Icons regenerated from logo.svg at ${Size}x${Size}." -ForegroundColor Green
