<#
Shared helpers for bump_version.ps1 and auto_version.ps1. Dot-sourced, not
run directly.
#>

# pubspec.yaml has non-ASCII em dashes in comments and no BOM. Windows
# PowerShell 5.1's Get-Content/Set-Content default to the system codepage and
# silently mangle those bytes -- reading/writing through .NET with an
# explicit no-BOM UTF8 encoding is what keeps the rest of the file untouched.
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:VersionLinePattern = '(?m)^version:\s*(\d+)\.(\d+)\.(\d+)\+(\d+)\s*$'

function Get-PubspecVersion([string]$PubspecPath) {
    $content = [System.IO.File]::ReadAllText($PubspecPath, $script:Utf8NoBom)
    $match = [regex]::Match($content, $script:VersionLinePattern)
    if (-not $match.Success) {
        throw "Couldn't find a 'version: X.Y.Z+B' line in $PubspecPath."
    }
    $major, $minor, $patch, $build = $match.Groups[1, 2, 3, 4].Value | ForEach-Object { [int]$_ }
    [PSCustomObject]@{
        Major = $major; Minor = $minor; Patch = $patch; Build = $build
        Content = $content
    }
}

function Set-PubspecVersion([string]$PubspecPath, [string]$Content, [int]$Major, [int]$Minor, [int]$Patch, [int]$Build) {
    $newLine = "version: $Major.$Minor.$Patch+$Build"
    $newContent = [regex]::Replace($Content, $script:VersionLinePattern, { param($m) $newLine })
    [System.IO.File]::WriteAllText($PubspecPath, $newContent, $script:Utf8NoBom)
}

# Commits, tags `v<Major.Minor.Patch>`, and pushes both. Shared by the manual
# (-Tag) and automatic release paths so there is exactly one place that talks
# to git.
function Publish-VersionTag([string]$RepoRoot, [string]$ShortVersion, [string]$FullVersion, [string]$CommitMessage) {
    Push-Location $RepoRoot
    try {
        & git add pubspec.yaml
        & git commit -m $CommitMessage
        if ($LASTEXITCODE -ne 0) { throw "git commit failed (exit $LASTEXITCODE)." }

        $tagName = "v$ShortVersion"
        & git tag -a $tagName -m "Release $ShortVersion"
        if ($LASTEXITCODE -ne 0) { throw "git tag failed (exit $LASTEXITCODE) -- does tag $tagName already exist?" }

        & git push origin HEAD $tagName
        if ($LASTEXITCODE -ne 0) { throw "git push failed (exit $LASTEXITCODE)." }

        Write-Host "Pushed $tagName -- GitHub Actions will build and publish the release." -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
}
