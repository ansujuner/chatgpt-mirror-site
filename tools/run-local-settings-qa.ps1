$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$QaScript = Join-Path $PSScriptRoot 'local_settings_qa.py'

if (-not (Test-Path -LiteralPath $QaScript -PathType Leaf)) {
  throw "Missing QA script: $QaScript"
}

$env:PYTHONUTF8 = '1'
Push-Location $ProjectRoot
try {
  python $QaScript
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
