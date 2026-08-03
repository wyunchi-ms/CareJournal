[CmdletBinding()]
param([string] $Branch = 'main', [switch] $PushTags)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $remotes = @(git remote)
  foreach ($required in @('origin', 'gitee')) {
    if ($remotes -notcontains $required) { throw "Missing git remote '$required'" }
  }
  $originPushUrls = @(git remote get-url --all --push origin)
  $originCoversGitee = $originPushUrls | Where-Object { $_ -match 'gitee\.com' }
  git push origin $Branch
  if ($LASTEXITCODE -ne 0) { throw 'Dual-origin push failed' }
  if (-not $originCoversGitee) {
    git push gitee $Branch
    if ($LASTEXITCODE -ne 0) { throw 'Gitee push failed' }
  }
  if ($PushTags) {
    git push origin --tags
    if ($LASTEXITCODE -ne 0) { throw 'Dual-origin tag push failed' }
    if (-not $originCoversGitee) {
      git push gitee --tags
      if ($LASTEXITCODE -ne 0) { throw 'Gitee tag push failed' }
    }
  }
} finally { Pop-Location }
