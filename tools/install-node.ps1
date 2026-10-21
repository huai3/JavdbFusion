$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'C:\Users\huai\AppData\Local\Temp\opencode\javdbfusion'
$tools = Join-Path $root 'tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null

# pick latest v24 LTS
$idx = (Invoke-WebRequest 'https://nodejs.org/dist/index.json' -UseBasicParsing -TimeoutSec 60).Content | ConvertFrom-Json
$v = $idx | Where-Object { $_.version -like 'v24.*' } | Select-Object -First 1
$ver = $v.version
Write-Output "node version: $ver"

$zip = Join-Path $tools "node-$ver-win-x64.zip"
if (-not (Test-Path $zip)) {
  Write-Output "downloading $zip ..."
  Invoke-WebRequest "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 600
}
$dest = Join-Path $tools 'node'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Output "extracting..."
& tar.exe -xzf $zip -C $dest
$nodeExe = Get-ChildItem -Path $dest -Filter node.exe -Recurse | Select-Object -First 1
Write-Output "node.exe: $($nodeExe.FullName)"
& $nodeExe.FullName --version
$npmCli = Join-Path $nodeExe.FullName.Substring(0, $nodeExe.FullName.LastIndexOf('\')) 'node_modules\npm\bin\npm-cli.js'
Write-Output "npm-cli: $npmCli  exists=$(Test-Path $npmCli)"
& $nodeExe.FullName $npmCli --version
