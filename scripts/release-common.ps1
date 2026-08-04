Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Core') { throw 'CareJournal release scripts require PowerShell 7 (pwsh).' }

$script:CareJournalReleaseConfig = @{
  ResourceGroup = 'rg-carejournal-release'
  Location = 'eastasia'
  StorageAccount = 'stcarejournal60f52ccd'
  StorageContainer = 'signing'
  KeyVault = 'kv-carejournal-60f52ccd'
  AndroidBlob = 'android/carejournal-release.p12'
  AndroidAliasSecret = 'android-keystore-alias'
  AndroidStorePasswordSecret = 'android-keystore-store-password'
  AndroidKeyPasswordSecret = 'android-keystore-key-password'
  AndroidHashSecret = 'android-keystore-sha256'
}

function Get-CareJournalVersion {
  param([Parameter(Mandatory)] [string] $ProjectRoot)
  $package = Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
  $version = [string]$package.version
  if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid package version: $version" }
  return $version
}

function Get-CareJournalReleaseNotes {
  param([Parameter(Mandatory)] [string] $ProjectRoot, [Parameter(Mandatory)] [string] $Version)
  $changelog = Get-Content -LiteralPath (Join-Path $ProjectRoot 'ChangeLog.md') -Raw
  $escaped = [regex]::Escape($Version)
  $match = [regex]::Match($changelog, "(?ms)^## v$escaped \([^\r\n]+\)\s*(.+?)(?=^## v|\z)")
  if (-not $match.Success) { throw "ChangeLog entry for v$Version not found" }
  return $match.Groups[1].Value.Trim()
}

function Assert-CareJournalAzContext {
  if (-not (Get-AzContext -ErrorAction SilentlyContinue)) { throw 'Azure PowerShell is not logged in. Run Connect-AzAccount first.' }
}

function Get-CareJournalSecretValue {
  param([Parameter(Mandatory)] [string] $Name)
  $secret = Get-AzKeyVaultSecret -VaultName $script:CareJournalReleaseConfig.KeyVault -Name $Name
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret.SecretValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Get-CareJournalStorageContext {
  return New-AzStorageContext -StorageAccountName $script:CareJournalReleaseConfig.StorageAccount -UseConnectedAccount
}

function Get-CareJournalAndroidSdk {
  foreach ($candidate in @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME, "$env:LOCALAPPDATA\Android\Sdk")) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
  }
  throw 'Android SDK not found. Set ANDROID_SDK_ROOT or ANDROID_HOME.'
}

function Assert-CareJournalVersions {
  param([Parameter(Mandatory)] [string] $ProjectRoot, [Parameter(Mandatory)] [string] $Version)
  $android = Get-Content -LiteralPath (Join-Path $ProjectRoot 'android\app\build.gradle') -Raw
  $androidVersion = [regex]::Match($android, 'versionName\s+"([^"]+)"').Groups[1].Value
  $harmony = Get-Content -LiteralPath (Join-Path $ProjectRoot 'harmony\AppScope\app.json5') -Raw | ConvertFrom-Json
  $tauri = Get-Content -LiteralPath (Join-Path $ProjectRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
  $iosProject = Get-Content -LiteralPath (Join-Path $ProjectRoot 'ios\App\App.xcodeproj\project.pbxproj') -Raw
  $iosVersion = [regex]::Match($iosProject, 'MARKETING_VERSION\s*=\s*([^;]+);').Groups[1].Value.Trim()
  if ($androidVersion -ne $Version -or [string]$harmony.app.versionName -ne $Version -or [string]$tauri.version -ne $Version -or $iosVersion -ne $Version) {
    throw "Version mismatch: package=$Version android=$androidVersion harmony=$($harmony.app.versionName) ios=$iosVersion tauri=$($tauri.version)"
  }
}

function Assert-CareJournalRemotes {
  param([Parameter(Mandatory)] [string] $ProjectRoot)
  Push-Location $ProjectRoot
  try {
    $expectedFetch = 'git@github.com:wyunchi-ms/CareJournal.git'
    $expectedGitee = 'git@gitee.com:wyunchi/care-journal.git'
    if ((git remote get-url origin).Trim() -ne $expectedFetch) { throw 'origin fetch URL is not the approved GitHub repository' }
    if ((git remote get-url gitee).Trim() -ne $expectedGitee) { throw 'gitee URL is not the approved Gitee repository' }
    $giteePushUrls = @(git remote get-url --all --push gitee)
    if ($giteePushUrls.Count -ne 1 -or $giteePushUrls[0] -ne $expectedGitee) { throw 'gitee push URL is not the approved Gitee repository' }
    $pushUrls = @(git remote get-url --all --push origin)
    if ($pushUrls.Count -ne 2 -or $pushUrls -notcontains $expectedFetch -or $pushUrls -notcontains $expectedGitee) { throw 'origin push URLs must exactly match the approved GitHub and Gitee repositories' }
  } finally { Pop-Location }
}

function Get-CareJournalGhPath {
  $command = Get-Command gh -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $fallback = 'C:\Program Files\GitHub CLI\gh.exe'
  if (Test-Path -LiteralPath $fallback) { return $fallback }
  return $null
}

function Get-CareJournalGiteeToken {
  if ($env:GITEE_TOKEN) { return $env:GITEE_TOKEN }
  $userToken = [Environment]::GetEnvironmentVariable('GITEE_TOKEN', 'User')
  if ($userToken) { return $userToken }
  try { return Get-CareJournalSecretValue -Name 'gitee-release-token' }
  catch { return $null }
}

function Assert-CareJournalCleanTree {
  param([Parameter(Mandatory)] [string] $ProjectRoot)
  Push-Location $ProjectRoot
  try {
    $status = git status --porcelain
    if ($status) { throw "Working tree is not clean:`n$status" }
  } finally { Pop-Location }
}

function Write-Sha256Manifest {
  param([Parameter(Mandatory)] [string[]] $Files, [Parameter(Mandatory)] [string] $OutputPath)
  $lines = foreach ($file in $Files) {
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path -Leaf $file)"
  }
  Set-Content -LiteralPath $OutputPath -Value $lines -Encoding utf8NoBOM
}
