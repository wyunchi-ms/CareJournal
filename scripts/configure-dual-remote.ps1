[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$github = 'git@github.com:wyunchi-ms/CareJournal.git'
$gitee = 'git@gitee.com:wyunchi/care-journal.git'
Push-Location $root
try {
  if (-not (git remote | Where-Object { $_ -eq 'origin' })) { git remote add origin $github }
  if (-not (git remote | Where-Object { $_ -eq 'gitee' })) { git remote add gitee $gitee }
  git remote set-url origin $github
  git remote set-url gitee $gitee
  git remote get-url --all --push origin | ForEach-Object { git remote set-url --delete --push origin ([regex]::Escape($_)) 2>$null }
  git remote set-url --add --push origin $github
  git remote set-url --add --push origin $gitee
  Write-Host 'origin fetches from GitHub and pushes to both GitHub and Gitee:'
  git remote -v
} finally { Pop-Location }
