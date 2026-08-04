[CmdletBinding(SupportsShouldProcess)]
param(
  [switch] $BuildOnly,
  [switch] $Prerelease
)

. (Join-Path $PSScriptRoot 'release-common.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = Get-CareJournalVersion -ProjectRoot $projectRoot
$tag = "v$version"
$releaseDirectory = Join-Path $projectRoot 'release'
Assert-CareJournalVersions -ProjectRoot $projectRoot -Version $version
Assert-CareJournalRemotes -ProjectRoot $projectRoot

if (-not $BuildOnly) { Assert-CareJournalCleanTree -ProjectRoot $projectRoot }

New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null
$artifacts = @()
$artifacts += & (Join-Path $PSScriptRoot 'build-android-release.ps1') -ProjectRoot $projectRoot -OutputDirectory $releaseDirectory
$desktopArchive = Join-Path $releaseDirectory "carejournal-v$version-windows-x64-portable.zip"
& (Join-Path $PSScriptRoot 'build-tauri-portable.ps1') -OutputPath $desktopArchive
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $desktopArchive -PathType Leaf)) { throw 'Windows portable build failed' }
$artifacts += $desktopArchive
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

  $giteeClient = [System.Net.Http.HttpClient]::new()
  $giteeClient.Timeout = [TimeSpan]::FromMinutes(5)
  try {
    $pairs = [System.Collections.Generic.List[System.Collections.Generic.KeyValuePair[string,string]]]::new()
    $giteeFields = [ordered]@{
      access_token=$giteeToken; tag_name=$tag; target_commitish='main'; name="CareJournal $tag";
      body=$notes; prerelease=([bool]$Prerelease).ToString().ToLowerInvariant(); draft='true'
    }
    foreach ($entry in $giteeFields.GetEnumerator()) {
      $pairs.Add([System.Collections.Generic.KeyValuePair[string,string]]::new([string]$entry.Key, [string]$entry.Value))
    }
    $requestContent = [System.Net.Http.FormUrlEncodedContent]::new($pairs)
    $response = $giteeClient.PostAsync('https://gitee.com/api/v5/repos/wyunchi/care-journal/releases', $requestContent).GetAwaiter().GetResult()
    $responseText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) { throw "Gitee release creation failed`n$responseText" }
    $giteeRelease = $responseText | ConvertFrom-Json
  } finally {
    $giteeClient.Dispose()
  }
  foreach ($file in $artifacts) {
    $curlConfig = Join-Path $releaseDirectory '.gitee-upload.curlrc'
    $escapedFile = $file.Replace('\','/').Replace('"','\"')
    @(
      'silent', 'show-error', 'fail-with-body', 'retry = 3', 'retry-all-errors',
      ('url = "{0}"' -f "https://gitee.com/api/v5/repos/wyunchi/care-journal/releases/$($giteeRelease.id)/attach_files"),
      ('form = "access_token={0}"' -f $giteeToken), ('form = "file=@{0}"' -f $escapedFile)
    ) | Set-Content -LiteralPath $curlConfig -Encoding utf8NoBOM
    & icacls.exe $curlConfig /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
    try {
      $responseText = & curl.exe --config $curlConfig
      if ($LASTEXITCODE -ne 0) { throw "Gitee upload failed for $file`n$responseText" }
      $uploaded = $responseText | ConvertFrom-Json
    } finally {
      if (Test-Path -LiteralPath $curlConfig) { Remove-Item -LiteralPath $curlConfig -Force }
    }
    if ($null -eq $uploaded.size -or [long]$uploaded.size -le 0 -or $uploaded.name -ne (Split-Path -Leaf $file) -or [long]$uploaded.size -ne (Get-Item -LiteralPath $file).Length) { throw "Gitee upload verification failed for $file" }
  }

  $githubRelease = Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/wyunchi-ms/CareJournal/releases/$($githubRelease.id)" -Headers $headers -ContentType 'application/json' -Body (@{ draft=$false } | ConvertTo-Json)
  $giteeRelease = Invoke-RestMethod -Method Patch -Uri "https://gitee.com/api/v5/repos/wyunchi/care-journal/releases/$($giteeRelease.id)" -Body @{ access_token=$giteeToken; tag_name=$tag; name="CareJournal $tag"; draft='false' } -ContentType 'application/x-www-form-urlencoded'
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
