[CmdletBinding()]
param(
  [string] $ProjectRoot,
  [string] $OutputDirectory
)

. (Join-Path $PSScriptRoot 'release-common.ps1')
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $ProjectRoot 'release' }
Assert-CareJournalAzContext
$version = Get-CareJournalVersion -ProjectRoot $ProjectRoot
$tempRoot = Join-Path $ProjectRoot '.tmp\release-signing'
$keystore = Join-Path $tempRoot 'carejournal-release.p12'
$expectedHash = Get-CareJournalSecretValue -Name $script:CareJournalReleaseConfig.AndroidHashSecret

New-Item -ItemType Directory -Force -Path $tempRoot, $OutputDirectory | Out-Null
try {
  $storageContext = Get-CareJournalStorageContext
  Get-AzStorageBlobContent -Container $script:CareJournalReleaseConfig.StorageContainer -Blob $script:CareJournalReleaseConfig.AndroidBlob -Destination $keystore -Context $storageContext -Force | Out-Null
  $actualHash = (Get-FileHash -LiteralPath $keystore -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) { throw "Android keystore hash mismatch. Expected $expectedHash, got $actualHash" }

  $env:CAREJOURNAL_ANDROID_KEYSTORE = $keystore
  $env:CAREJOURNAL_ANDROID_STORE_PASSWORD = Get-CareJournalSecretValue -Name $script:CareJournalReleaseConfig.AndroidStorePasswordSecret
  $env:CAREJOURNAL_ANDROID_KEY_ALIAS = Get-CareJournalSecretValue -Name $script:CareJournalReleaseConfig.AndroidAliasSecret
  $env:CAREJOURNAL_ANDROID_KEY_PASSWORD = Get-CareJournalSecretValue -Name $script:CareJournalReleaseConfig.AndroidKeyPasswordSecret

  npm run android:sync
  if ($LASTEXITCODE -ne 0) { throw 'Capacitor Android sync failed' }
  $env:GRADLE_USER_HOME = Join-Path $ProjectRoot '.gradle-local'
  $env:ANDROID_USER_HOME = Join-Path $ProjectRoot '.android'
  Push-Location (Join-Path $ProjectRoot 'android')
  try {
    & .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Android release build failed' }
  } finally { Pop-Location }

  $source = Join-Path $ProjectRoot 'android\app\build\outputs\apk\release\app-release.apk'
  if (-not (Test-Path -LiteralPath $source)) { throw "Release APK missing: $source" }
  $androidSdk = Get-CareJournalAndroidSdk
  $apksigner = Get-ChildItem -LiteralPath (Join-Path $androidSdk 'build-tools') -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $apksigner) { throw 'Android apksigner was not found' }
  & $apksigner.FullName verify --verbose --print-certs $source | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
  $target = Join-Path $OutputDirectory "carejournal-v$version-android.apk"
  Copy-Item -LiteralPath $source -Destination $target -Force
  return $target
} finally {
  Remove-Item Env:CAREJOURNAL_ANDROID_KEYSTORE,Env:CAREJOURNAL_ANDROID_STORE_PASSWORD,Env:CAREJOURNAL_ANDROID_KEY_ALIAS,Env:CAREJOURNAL_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $keystore) { Remove-Item -LiteralPath $keystore -Force }
}
