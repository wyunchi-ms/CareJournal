[CmdletBinding()]
param(
  [switch] $StoreGiteeToken
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

if ($StoreGiteeToken) {
  $giteeToken = Read-Host 'Gitee personal access token' -AsSecureString
  Set-AzKeyVaultSecret -VaultName $config.KeyVault -Name 'gitee-release-token' -SecretValue $giteeToken -ContentType 'Gitee Release API token' | Out-Null
}

[pscustomobject]@{
  ResourceGroup = $config.ResourceGroup
  StorageAccount = $config.StorageAccount
  Container = $config.StorageContainer
  KeyVault = $config.KeyVault
  GiteeTokenStored = [bool]$StoreGiteeToken
} | Format-List
