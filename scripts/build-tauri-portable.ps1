param(
  [string]$Configuration = "release",
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriDir = Join-Path $repoRoot "src-tauri"
$outDir = Join-Path $repoRoot "release\tauri-portable"
$targetDir = Join-Path $tauriDir "target\$Configuration"
$exePath = Join-Path $targetDir "CareJournal.exe"

if (-not (Test-Path -LiteralPath $tauriDir)) {
  throw "src-tauri directory not found: $tauriDir"
}

Push-Location $repoRoot
try {
  npm run build
  npm exec -- tauri build --no-bundle
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $exePath)) {
  throw "Expected executable not found: $exePath"
}

if (Test-Path -LiteralPath $outDir) {
  $stagedExe = Join-Path $outDir 'CareJournal.exe'
  Get-CimInstance Win32_Process -Filter "Name='CareJournal.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -eq $stagedExe } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -LiteralPath $outDir -Recurse -Force
}
New-Item -ItemType Directory -Path $outDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outDir "CareJournalData") | Out-Null
Copy-Item -LiteralPath $exePath -Destination (Join-Path $outDir "CareJournal.exe")
@(
  'CareJournal Windows x64 portable',
  '',
  'Run CareJournal.exe directly. Keep CareJournal.exe and CareJournalData together when moving the app.',
  'The app requires Microsoft Edge WebView2 Runtime, which is normally included with Windows 10/11.',
  'See docs/WINDOWS_DESKTOP.md in the source repository for details.'
) | Set-Content -LiteralPath (Join-Path $outDir 'README.txt') -Encoding utf8NoBOM
'CareJournal stores local app data in this directory. Do not delete it unless you intend to erase the desktop data.' |
  Set-Content -LiteralPath (Join-Path $outDir 'CareJournalData\README.txt') -Encoding utf8NoBOM

$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$zipPath = if ($OutputPath) { $OutputPath } else { Join-Path $repoRoot "release\carejournal-v$version-windows-x64-portable.zip" }
$zipParent = Split-Path -Parent $zipPath
if (-not (Test-Path -LiteralPath $zipParent)) { New-Item -ItemType Directory -Path $zipParent -Force | Out-Null }
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $outDir "*") -DestinationPath $zipPath
"Created $zipPath"
