[CmdletBinding(SupportsShouldProcess)]
param(
  [switch] $BuildOnly,
  [switch] $AllowUnsignedHarmony,
  [switch] $Prerelease
)

. (Join-Path $PSScriptRoot 'release-common.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = Get-CareJournalVersion -ProjectRoot $projectRoot
$tag = "v$version"
$releaseDirectory = Join-Path $projectRoot 'release'
if ($AllowUnsignedHarmony -and -not $BuildOnly) { throw '-AllowUnsignedHarmony is only valid with -BuildOnly' }
Assert-CareJournalVersions -ProjectRoot $projectRoot -Version $version
Assert-CareJournalRemotes -ProjectRoot $projectRoot

if (-not $BuildOnly) { Assert-CareJournalCleanTree -ProjectRoot $projectRoot }

New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
$artifacts = @()
$artifacts += & (Join-Path $PSScriptRoot 'build-android-release.ps1') -ProjectRoot $projectRoot -OutputDirectory $releaseDirectory
$artifacts += & (Join-Path $PSScriptRoot 'build-harmony-release.ps1') -ProjectRoot $projectRoot -OutputDirectory $releaseDirectory -AllowUnsigned:$AllowUnsignedHarmony
$artifacts = @($artifacts | ForEach-Object {
  if ($_ -is [System.IO.FileInfo]) { $_.FullName }
  elseif ($_ -is [string] -and $_ -and (Test-Path -LiteralPath $_ -PathType Leaf)) { (Resolve-Path -LiteralPath $_).Path }
} | Where-Object { $_ } | Sort-Object -Unique)
if (-not $artifacts.Count) { throw 'No release artifacts were produced' }
$checksum = Join-Path $releaseDirectory 'SHA256SUMS.txt'
Write-Sha256Manifest -Files $artifacts -OutputPath $checksum
$artifacts += $checksum

if ($BuildOnly) {
  Write-Host "Build-only completed for $tag"
  $artifacts | ForEach-Object { Write-Host "  $_" }
  return
}

$githubToken = $env:GITHUB_TOKEN
if (-not $githubToken) {
  $ghPath = Get-CareJournalGhPath
  if ($ghPath) { $githubToken = (& $ghPath auth token 2>$null) }
}
if (-not $githubToken) { throw 'GITHUB_TOKEN is not configured and gh auth token is unavailable' }
$giteeToken = Get-CareJournalGiteeToken
if (-not $giteeToken) { throw 'GITEE_TOKEN is not configured' }
if ($artifacts | Where-Object { (Split-Path -Leaf $_) -match 'unsigned' }) { throw 'Unsigned artifacts cannot be published' }

$notes = Get-CareJournalReleaseNotes -ProjectRoot $projectRoot -Version $version
$notesPath = Join-Path $releaseDirectory 'RELEASE_NOTES.md'
Set-Content -LiteralPath $notesPath -Value $notes -Encoding utf8NoBOM

Push-Location $projectRoot
$githubRelease = $null
$giteeRelease = $null
$tagPushAttempted = $false
try {
  $head = (git rev-parse HEAD).Trim()
  foreach ($remote in @('origin', 'gitee')) {
    $remoteHead = (git ls-remote $remote refs/heads/main | ForEach-Object { ($_ -split '\s+')[0] }).Trim()
    if ($remoteHead -ne $head) { throw "$remote/main is not at local HEAD. Run scripts/push-all.ps1 first." }
  }
  if (git tag --list $tag) { throw "Tag $tag already exists locally" }
  git tag -a $tag -m "CareJournal $version"
  $tagPushAttempted = $true
  git push origin $tag
  if ($LASTEXITCODE -ne 0) { throw 'GitHub tag push failed' }
  $originPushUrls = @(git remote get-url --all --push origin)
  if (-not ($originPushUrls | Where-Object { $_ -match 'gitee\.com' })) {
    git push gitee $tag
    if ($LASTEXITCODE -ne 0) { throw 'Gitee tag push failed' }
  }

  $headers = @{ Authorization = "Bearer $githubToken"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
  $githubBody = @{ tag_name=$tag; target_commitish='main'; name="CareJournal $tag"; body=$notes; draft=$true; prerelease=[bool]$Prerelease } | ConvertTo-Json
  $githubRelease = Invoke-RestMethod -Method Post -Uri 'https://api.github.com/repos/wyunchi-ms/CareJournal/releases' -Headers $headers -ContentType 'application/json' -Body $githubBody
  foreach ($file in $artifacts) {
    $name = [Uri]::EscapeDataString((Split-Path -Leaf $file))
    $uploaded = Invoke-RestMethod -Method Post -Uri "$($githubRelease.upload_url -replace '\{\?name,label\}$','')?name=$name" -Headers $headers -ContentType 'application/octet-stream' -InFile $file
    if ($uploaded.name -ne (Split-Path -Leaf $file) -or [long]$uploaded.size -ne (Get-Item -LiteralPath $file).Length) { throw "GitHub upload verification failed for $file" }
  }

  $giteeForm = @{ access_token=$giteeToken; tag_name=$tag; target_commitish='main'; name="CareJournal $tag"; body=$notes; prerelease=([bool]$Prerelease).ToString().ToLowerInvariant(); draft='true' }
  $giteeRelease = Invoke-RestMethod -Method Post -Uri 'https://gitee.com/api/v5/repos/wyunchi/care-journal/releases' -Body $giteeForm -ContentType 'application/x-www-form-urlencoded'
  foreach ($file in $artifacts) {
    $uploaded = Invoke-RestMethod -Method Post -Uri "https://gitee.com/api/v5/repos/wyunchi/care-journal/releases/$($giteeRelease.id)/attach_files" -Form @{ access_token=$giteeToken; file=Get-Item -LiteralPath $file }
    if ($null -eq $uploaded.size -or [long]$uploaded.size -le 0 -or $uploaded.name -ne (Split-Path -Leaf $file) -or [long]$uploaded.size -ne (Get-Item -LiteralPath $file).Length) { throw "Gitee upload verification failed for $file" }
  }

  $githubRelease = Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/wyunchi-ms/CareJournal/releases/$($githubRelease.id)" -Headers $headers -ContentType 'application/json' -Body (@{ draft=$false } | ConvertTo-Json)
  $giteeRelease = Invoke-RestMethod -Method Patch -Uri "https://gitee.com/api/v5/repos/wyunchi/care-journal/releases/$($giteeRelease.id)" -Body @{ access_token=$giteeToken; draft='false' } -ContentType 'application/x-www-form-urlencoded'
} catch {
  if ($githubRelease) { Invoke-RestMethod -Method Delete -Uri "https://api.github.com/repos/wyunchi-ms/CareJournal/releases/$($githubRelease.id)" -Headers $headers -ErrorAction SilentlyContinue }
  if ($giteeRelease) { Invoke-RestMethod -Method Delete -Uri "https://gitee.com/api/v5/repos/wyunchi/care-journal/releases/$($giteeRelease.id)" -Body @{ access_token=$giteeToken } -ContentType 'application/x-www-form-urlencoded' -ErrorAction SilentlyContinue }
  if ($tagPushAttempted) {
    git push origin ":refs/tags/$tag" 2>$null
    git push gitee ":refs/tags/$tag" 2>$null
  }
  git tag -d $tag 2>$null
  Write-Warning "Release rolled back after failure: $($_.Exception.Message)"
  throw
} finally {
  $githubToken = $null
  $giteeToken = $null
  Pop-Location
}

Write-Host "Published $tag to GitHub and Gitee"
