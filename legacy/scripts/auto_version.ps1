<#
.SYNOPSIS
    Decides Major/Minor/Patch from commit messages since the last release
    tag and bumps pubspec.yaml. Called automatically by build_windows.ps1
    before every build -- run standalone only to preview or debug it.

.DESCRIPTION
    Looks at every commit message since the last `vX.Y.Z*` tag and picks the
    bump from the first rule that matches, in this order:

        any commit contains "major"           -> Major
        any commit contains "rework"           -> Minor
        10+ commits with neither keyword       -> Minor (that many changes
                                                   add up to more than a patch
                                                   even if nobody said so)
        anything else                          -> Patch (the default -- this
                                                   is also what "fix" commits
                                                   get, since Patch is already
                                                   the fallback)

    Skips the bump entirely (no error) when there's nothing to release:
    zero commits since the last tag, no tag exists yet, or the working tree
    has uncommitted changes (bumping then would tag a commit that doesn't
    match what's actually on disk).

    For a Major release you want regardless of commit wording, don't rely on
    this -- run scripts/bump_version.ps1 -Part Major -Tag instead.

.OUTPUTS
    A PSCustomObject: { Bumped, Part, Version, ShortVersion, Reason }. On a skip,
    Bumped is $false and Reason says why; build_windows.ps1 reads this to decide
    whether to tag + push after a successful build (and now stops the build with
    Reason when it can't).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PubspecPath = Join-Path $RepoRoot 'pubspec.yaml'
. (Join-Path $PSScriptRoot '_version_common.ps1')

function Skip([string]$reason) {
    Write-Host "auto_version: $reason -- skipping." -ForegroundColor Yellow
    [PSCustomObject]@{ Bumped = $false; Part = $null; Version = $null; ShortVersion = $null; Reason = $reason }
}

Push-Location $RepoRoot
try {
    if (git status --porcelain) {
        return Skip 'working tree has uncommitted changes'
    }

    $lastTag = (& git describe --tags --match 'v*.*.*' --abbrev=0 2>$null)
    if (-not $lastTag) {
        return Skip 'no v*.*.* tag found yet (create the first release with bump_version.ps1)'
    }

    $range = "$lastTag..HEAD"
    $commitCount = [int](& git rev-list --count $range)
    if ($commitCount -eq 0) {
        return Skip "no commits since $lastTag"
    }

    $messages = (& git log $range --format='%B') -join "`n"

    $part =
        if ($messages -match '(?i)\bmajor\b') { 'Major' }
        elseif ($messages -match '(?i)\brework\b') { 'Minor' }
        elseif ($commitCount -ge 10) { 'Minor' }
        else { 'Patch' }

    Write-Host "auto_version: $commitCount commit(s) since $lastTag -> $part" -ForegroundColor Cyan
}
finally {
    Pop-Location
}

$current = Get-PubspecVersion $PubspecPath
$major, $minor, $patch, $build = $current.Major, $current.Minor, $current.Patch, $current.Build

switch ($part) {
    'Major' { $major++; $minor = 0; $patch = 0 }
    'Minor' { $minor++; $patch = 0 }
    'Patch' { $patch++ }
}
$build++

Set-PubspecVersion $PubspecPath $current.Content $major $minor $patch $build
$newVersion = "$major.$minor.$patch+$build"
Write-Host "pubspec.yaml: $($current.Major).$($current.Minor).$($current.Patch)+$($current.Build) -> $newVersion" -ForegroundColor Green

[PSCustomObject]@{
    Bumped = $true
    Part = $part
    Version = $newVersion
    ShortVersion = "$major.$minor.$patch"
    Reason = $null
}
