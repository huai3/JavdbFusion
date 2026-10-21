$ErrorActionPreference = 'Continue'
$root = 'C:\Users\huai\AppData\Local\Temp\opencode\javdbfusion'
$node = "$root\tools\node\node-v24.22.1-win-x64\node.exe"
$npm  = "$root\tools\node\node-v24.22.1-win-x64\node_modules\npm\bin\npm-cli.js"
$proj = "$root\pw"
New-Item -ItemType Directory -Force -Path $proj | Out-Null
Set-Location $proj

$env:PATH = "$root\tools\node\node-v24.22.1-win-x64;" + $env:PATH

if (-not (Test-Path "$proj\package.json")) {
  & $node $npm init -y 2>&1 | Select-Object -Last 2
}
Write-Output "=== npm i playwright ==="
& $node $npm install playwright@latest --no-audit --no-fund 2>&1 | Select-Object -Last 15
Write-Output "=== npx playwright install chromium ==="
& $node "$proj\node_modules\playwright\cli.js" install chromium 2>&1 | Select-Object -Last 20
Write-Output "=== done ==="
Get-ChildItem "$env:LOCALAPPDATA\ms-playwright" -ErrorAction SilentlyContinue | Select-Object Name
