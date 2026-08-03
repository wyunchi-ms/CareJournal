[CmdletBinding()]
param(
  [string] $ProjectRoot,
  [string] $OutputDirectory,
  [switch] $AllowUnsigned
)

. (Join-Path $PSScriptRoot 'release-common.ps1')
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $ProjectRoot 'release' }
$version = Get-CareJournalVersion -ProjectRoot $ProjectRoot
$profile = Join-Path $ProjectRoot 'harmony\build-profile.json5'
$template = Join-Path $ProjectRoot 'harmony\build-profile.template.json5'
$tempRoot = Join-Path $ProjectRoot '.tmp\harmony-release-signing'
$signed = $false

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
try {
  Assert-CareJournalAzContext
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  $storageContext = Get-CareJournalStorageContext
  $p12 = Join-Path $tempRoot 'release.p12'; $cer = Join-Path $tempRoot 'release.cer'; $p7b = Join-Path $tempRoot 'release.p7b'
  try {
    Get-AzStorageBlobContent -Container $script:CareJournalReleaseConfig.StorageContainer -Blob $script:CareJournalReleaseConfig.HarmonyP12Blob -Destination $p12 -Context $storageContext -Force | Out-Null
    Get-AzStorageBlobContent -Container $script:CareJournalReleaseConfig.StorageContainer -Blob $script:CareJournalReleaseConfig.HarmonyCerBlob -Destination $cer -Context $storageContext -Force | Out-Null
    Get-AzStorageBlobContent -Container $script:CareJournalReleaseConfig.StorageContainer -Blob $script:CareJournalReleaseConfig.HarmonyProfileBlob -Destination $p7b -Context $storageContext -Force | Out-Null
    $storePassword = Get-CareJournalSecretValue -Name $script:CareJournalReleaseConfig.HarmonyStorePasswordSecret
    $keyPassword = Get-CareJournalSecretValue -Name $script:CareJournalReleaseConfig.HarmonyKeyPasswordSecret
    $keyAlias = Get-CareJournalSecretValue -Name $script:CareJournalReleaseConfig.HarmonyAliasSecret
    $signed = $true
  } catch {
    if (-not $AllowUnsigned) { throw 'Harmony signing material is unavailable in Azure. Generate .p12/.csr in DevEco, obtain .cer/.p7b from AppGallery Connect, then upload it.' }
    $signed = $false
  }

  if (-not (Test-Path -LiteralPath $profile)) { Copy-Item -LiteralPath $template -Destination $profile }

  & (Join-Path $ProjectRoot 'scripts\build-harmony.ps1') -BuildMode release
  if ($LASTEXITCODE -ne 0) { throw 'Harmony build failed' }
  $unsignedHap = (Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'harmony\entry\build') -Recurse -Filter '*-unsigned.hap' | Where-Object Length -GT 0 | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
  $appSource = (Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'harmony\build') -Recurse -Filter *.app | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
  $outputs = @()
  if (-not $unsignedHap) { throw 'Harmony unsigned HAP was not produced' }
  if ($signed) {
    $deveco = Get-CareJournalDevEcoRoot
    $java = Join-Path $deveco 'jbr\bin\java.exe'
    $signTool = Join-Path $deveco 'sdk\default\openharmony\toolchains\lib\hap-sign-tool.jar'
    $signedHap = Join-Path $OutputDirectory "carejournal-v$version-harmony-signed.hap"
    $argumentFile = Join-Path $tempRoot 'signing.args'
    $quote = { param([string]$value) '"' + $value.Replace('\','\\').Replace('"','\"') + '"' }
    $signArgs = @(
      '-jar', (& $quote $signTool), 'sign-app', '-mode', 'localSign', '-keyAlias', (& $quote $keyAlias),
      '-keyPwd', (& $quote $keyPassword), '-appCertFile', (& $quote $cer), '-profileFile', (& $quote $p7b),
      '-profileSigned', '1', '-inFile', (& $quote $unsignedHap), '-signAlg', 'SHA256withECDSA',
      '-keystoreFile', (& $quote $p12), '-keystorePwd', (& $quote $storePassword), '-outFile', (& $quote $signedHap),
      '-compatibleVersion', '20', '-signCode', '1'
    )
    Set-Content -LiteralPath $argumentFile -Value $signArgs -Encoding ascii
    & icacls.exe $argumentFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
    try {
      & $java "@$argumentFile"
      if ($LASTEXITCODE -ne 0) { throw 'Harmony HAP signing failed' }
    } finally {
      if (Test-Path -LiteralPath $argumentFile) { Remove-Item -LiteralPath $argumentFile -Force }
    }
    $verifyCert = Join-Path $tempRoot 'verify-cert.cer'; $verifyProfile = Join-Path $tempRoot 'verify-profile.p7b'
    & $java -jar $signTool verify-app -inFile $signedHap -outCertChain $verifyCert -outProfile $verifyProfile
    if ($LASTEXITCODE -ne 0) { throw 'Harmony HAP signature verification failed' }
    $outputs += $signedHap
  } else {
    $target = Join-Path $OutputDirectory "carejournal-v$version-harmony-unsigned.hap"
    Copy-Item $unsignedHap $target -Force
    $outputs += $target
    if ($appSource -and (Test-Path -LiteralPath $appSource)) {
      $appTarget = Join-Path $OutputDirectory "carejournal-v$version-harmony-unsigned.app"
      Copy-Item $appSource $appTarget -Force
      $outputs += $appTarget
    }
  }
  if (-not $outputs.Count) { throw 'Harmony artifacts were not produced' }
  return $outputs
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
