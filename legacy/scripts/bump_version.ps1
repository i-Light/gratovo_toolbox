<#
.SYNOPSIS
    Manually bump pubspec.yaml's version and, optionally, tag + push to
    release it. Use this for Major bumps -- see NOTE below.

.DESCRIPTION
    Most of the time you don't need this script: build_windows.ps1 runs
    scripts/auto_version.ps1 before every build, which reads the commit
    messages since the last release tag and bumps Patch or Minor on its own
    (see that script's header for the exact rule). This one is for when you
    want a SPECIFIC part bumped regardless of what the commits say.

    NOTE -- Major is never chosen automatically unless a commit message
    contains the word "major" (see auto_version.ps1). If you want a Major
    release and don't want to rely on remembering that keyword, run this
    directly:

        .\scripts\bump_version.ps1 -Part Major -Tag

.PARAMETER Part
    Which part to bump: Major, Minor, Patch, or Build. Major/Minor/Patch
    reset the parts to their right to zero; Build always just increments.

.PARAMETER Tag
    Commit pubspec.yaml, tag `v<version>`, and push -- which triggers
    .github/workflows/release.yml. Without it, only the file is edited, so
    you can review the diff first.

.EXAMPLE
    .\scripts\bump_version.ps1 -Part Major -Tag
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Major', 'Minor', 'Patch', 'Build')]
    [string]$Part,
    [switch]$Tag
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PubspecPath = Join-Path $RepoRoot 'pubspec.yaml'
. (Join-Path $PSScriptRoot '_version_common.ps1')

$current = Get-PubspecVersion $PubspecPath
$major, $minor, $patch, $build = $current.Major, $current.Minor, $current.Patch, $current.Build
$oldVersion = "$major.$minor.$patch+$build"

switch ($Part) {
    'Major' { $major++; $minor = 0; $patch = 0 }
    'Minor' { $minor++; $patch = 0 }
    'Patch' { $patch++ }
    'Build' { } # version string unchanged, only build increments below
}
$build++

Set-PubspecVersion $PubspecPath $current.Content $major $minor $patch $build
$newVersion = "$major.$minor.$patch+$build"
$shortNew = "$major.$minor.$patch"
Write-Host "pubspec.yaml: $oldVersion -> $newVersion" -ForegroundColor Green

if ($Tag) {
    Publish-VersionTag $RepoRoot $shortNew $newVersion "Bump version to $newVersion"
} else {
    Write-Host "Review the change, commit it, then tag+push to release:" -ForegroundColor Yellow
    Write-Host "    git add pubspec.yaml && git commit -m `"Bump version to $newVersion`""
    Write-Host "    git tag v$shortNew && git push origin HEAD v$shortNew"
}
