$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$devecoRoot = if ($env:DEVECO_STUDIO_HOME) {
  $env:DEVECO_STUDIO_HOME
} else {
  'C:\Program Files\Huawei\DevEco Studio'
}
$nodeExe = Join-Path $devecoRoot 'tools\node\node.exe'
$hvigor = Join-Path $devecoRoot 'tools\hvigor\bin\hvigorw.js'
$javaHome = Join-Path $devecoRoot 'jbr'
$sdkHome = Join-Path $devecoRoot 'sdk'

foreach ($requiredPath in @($nodeExe, $hvigor, $javaHome, $sdkHome)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Missing DevEco Studio build dependency: $requiredPath. Set DEVECO_STUDIO_HOME for a custom install path."
  }
}

Push-Location $projectRoot
try {
  npm run harmony:sync
  if ($LASTEXITCODE -ne 0) {
    throw 'Shared frontend build or HarmonyOS asset sync failed.'
  }

  $env:DEVECO_SDK_HOME = $sdkHome
  $env:NODE_HOME = Split-Path -Parent $nodeExe
  $env:JAVA_HOME = $javaHome
  $env:PATH = "$(Join-Path $javaHome 'bin');$env:NODE_HOME;$env:PATH"

  Push-Location (Join-Path $projectRoot 'harmony')
  try {
    & $nodeExe $hvigor --stop-daemon
    & $nodeExe $hvigor --mode project -p product=default -p buildMode=debug assembleApp
    if ($LASTEXITCODE -ne 0) {
      throw 'HarmonyOS HAP build failed.'
    }
  } finally {
    Pop-Location
  }

  $hap = Join-Path $projectRoot 'harmony\entry\build\default\outputs\default\app\entry-default.hap'
  $app = Join-Path $projectRoot 'harmony\build\outputs\default\harmony-default-unsigned.app'
  Write-Host 'HarmonyOS build completed:'
  Write-Host "  HAP: $hap"
  Write-Host "  APP: $app"
} finally {
  Pop-Location
}
