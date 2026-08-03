[CmdletBinding()]
param(
  [string] $OutputDirectory,
  [string] $Alias = 'carejournal-harmony-release'
)

. (Join-Path $PSScriptRoot 'release-common.ps1')
Assert-CareJournalAzContext
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'release' }
$temp = Join-Path $projectRoot '.tmp\harmony-signing-request'
$p12 = Join-Path $temp 'carejournal-harmony-release.p12'
$csr = Join-Path $OutputDirectory 'carejournal-harmony-release.csr'
$chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#%_-'
function New-SigningPassword([int] $Length) {
  $bytes = [byte[]]::new($Length)
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

New-Item -ItemType Directory -Force -Path $temp, $OutputDirectory | Out-Null
$password = New-SigningPassword 40
$keytool = Join-Path (Get-CareJournalDevEcoRoot) 'jbr\bin\keytool.exe'
try {
  $argFile = Join-Path $temp 'keytool.args'
  @(
    '-genkeypair','-storetype','PKCS12','-keystore',('"'+$p12+'"'),'-storepass',('"'+$password+'"'),'-keypass',('"'+$password+'"'),
    '-alias',('"'+$Alias+'"'),'-keyalg','EC','-groupname','secp256r1','-sigalg','SHA256withECDSA','-validity','10000',
    '-dname','"CN=CareJournal, OU=Harmony Release, O=CareJournal Open Source, L=Hong Kong, ST=Hong Kong, C=CN"'
  ) | Set-Content -LiteralPath $argFile -Encoding ascii
  & icacls.exe $argFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  & $keytool "@$argFile"
  if ($LASTEXITCODE -ne 0) { throw 'DevEco keytool failed to create Harmony signing key' }
  @('-certreq','-keystore',('"'+$p12+'"'),'-storepass',('"'+$password+'"'),'-alias',('"'+$Alias+'"'),'-file',('"'+$csr+'"'),'-sigalg','SHA256withECDSA') | Set-Content -LiteralPath $argFile -Encoding ascii
  & $keytool "@$argFile"
  if ($LASTEXITCODE -ne 0) { throw 'DevEco keytool failed to create CSR' }
  $context = Get-CareJournalStorageContext
  Set-AzStorageBlobContent -File $p12 -Container $script:CareJournalReleaseConfig.StorageContainer -Blob $script:CareJournalReleaseConfig.HarmonyP12Blob -Context $context -Force | Out-Null
  Set-AzKeyVaultSecret -VaultName $script:CareJournalReleaseConfig.KeyVault -Name $script:CareJournalReleaseConfig.HarmonyStorePasswordSecret -SecretValue (ConvertTo-SecureString $password -AsPlainText -Force) | Out-Null
  Set-AzKeyVaultSecret -VaultName $script:CareJournalReleaseConfig.KeyVault -Name $script:CareJournalReleaseConfig.HarmonyKeyPasswordSecret -SecretValue (ConvertTo-SecureString $password -AsPlainText -Force) | Out-Null
  Set-AzKeyVaultSecret -VaultName $script:CareJournalReleaseConfig.KeyVault -Name $script:CareJournalReleaseConfig.HarmonyAliasSecret -SecretValue (ConvertTo-SecureString $Alias -AsPlainText -Force) | Out-Null
  Write-Host "CSR created: $csr"
  Write-Host 'Upload this CSR to AppGallery Connect, then download the release .cer and .p7b/profile.'
} finally {
  if (Test-Path -LiteralPath (Join-Path $temp 'keytool.args')) { Remove-Item -LiteralPath (Join-Path $temp 'keytool.args') -Force }
  if (Test-Path -LiteralPath $p12) { Remove-Item -LiteralPath $p12 -Force }
}
