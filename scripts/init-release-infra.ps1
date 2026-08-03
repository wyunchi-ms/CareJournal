[CmdletBinding()]
param(
  [switch] $StoreGiteeToken,
  [switch] $UploadHarmonySigning,
  [string] $HarmonyP12,
  [string] $HarmonyCertificate,
  [string] $HarmonyProfile,
  [string] $HarmonyKeyAlias
)

. (Join-Path $PSScriptRoot 'release-common.ps1')
Assert-CareJournalAzContext
$config = $script:CareJournalReleaseConfig
if (-not (Get-AzResourceGroup -Name $config.ResourceGroup -ErrorAction SilentlyContinue)) {
  New-AzResourceGroup -Name $config.ResourceGroup -Location $config.Location | Out-Null
}
if (-not (Get-AzStorageAccount -ResourceGroupName $config.ResourceGroup -Name $config.StorageAccount -ErrorAction SilentlyContinue)) {
  New-AzStorageAccount -ResourceGroupName $config.ResourceGroup -Name $config.StorageAccount -Location $config.Location -SkuName Standard_LRS -Kind StorageV2 -AllowBlobPublicAccess $false -MinimumTlsVersion TLS1_2 -EnableHttpsTrafficOnly $true | Out-Null
}
if (-not (Get-AzKeyVault -VaultName $config.KeyVault -ErrorAction SilentlyContinue)) {
  New-AzKeyVault -Name $config.KeyVault -ResourceGroupName $config.ResourceGroup -Location $config.Location -Sku Standard -SoftDeleteRetentionInDays 90 -EnablePurgeProtection | Out-Null
}
$storageContext = Get-CareJournalStorageContext
if (-not (Get-AzStorageContainer -Name $config.StorageContainer -Context $storageContext -ErrorAction SilentlyContinue)) {
  New-AzStorageContainer -Name $config.StorageContainer -Context $storageContext -Permission Off | Out-Null
}

if ($UploadHarmonySigning) {
  foreach ($file in @($HarmonyP12, $HarmonyCertificate, $HarmonyProfile)) {
    if (-not $file -or -not (Test-Path -LiteralPath $file)) { throw "Harmony signing file missing: $file" }
  }
  if (-not $HarmonyKeyAlias) { throw 'HarmonyKeyAlias is required' }
  $storePassword = Read-Host 'Harmony P12 store password' -AsSecureString
  $keyPassword = Read-Host 'Harmony private key password' -AsSecureString
  Set-AzStorageBlobContent -File $HarmonyP12 -Container $config.StorageContainer -Blob $config.HarmonyP12Blob -Context $storageContext -Force | Out-Null
  Set-AzStorageBlobContent -File $HarmonyCertificate -Container $config.StorageContainer -Blob $config.HarmonyCerBlob -Context $storageContext -Force | Out-Null
  Set-AzStorageBlobContent -File $HarmonyProfile -Container $config.StorageContainer -Blob $config.HarmonyProfileBlob -Context $storageContext -Force | Out-Null
  Set-AzKeyVaultSecret -VaultName $config.KeyVault -Name $config.HarmonyStorePasswordSecret -SecretValue $storePassword | Out-Null
  Set-AzKeyVaultSecret -VaultName $config.KeyVault -Name $config.HarmonyKeyPasswordSecret -SecretValue $keyPassword | Out-Null
  Set-AzKeyVaultSecret -VaultName $config.KeyVault -Name $config.HarmonyAliasSecret -SecretValue (ConvertTo-SecureString $HarmonyKeyAlias -AsPlainText -Force) | Out-Null
}
if ($StoreGiteeToken) {
  $giteeToken = Read-Host 'Gitee personal access token' -AsSecureString
  Set-AzKeyVaultSecret -VaultName $config.KeyVault -Name 'gitee-release-token' -SecretValue $giteeToken -ContentType 'Gitee Release API token' | Out-Null
}

[pscustomobject]@{
  ResourceGroup = $config.ResourceGroup
  StorageAccount = $config.StorageAccount
  Container = $config.StorageContainer
  KeyVault = $config.KeyVault
  HarmonySigningUploaded = [bool]$UploadHarmonySigning
  GiteeTokenStored = [bool]$StoreGiteeToken
} | Format-List
