$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

python "$repoRoot\scripts\generate-icons.py"

npm run tauri build -- --bundles nsis

$releaseDir = Join-Path $repoRoot "release"
if (Test-Path $releaseDir) {
  Remove-Item $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

$exeSource = Join-Path $repoRoot "src-tauri\target\release\claude-dynamic-island.exe"
$resourcesSource = Join-Path $repoRoot "src-tauri\target\release\_up_"
$setupSource = Get-ChildItem (Join-Path $repoRoot "src-tauri\target\release\bundle\nsis\*setup.exe") |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

Copy-Item $exeSource (Join-Path $releaseDir "Claude Dynamic Island.exe")
if (Test-Path $resourcesSource) {
  Copy-Item $resourcesSource (Join-Path $releaseDir "_up_") -Recurse
}
if ($setupSource) {
  Copy-Item $setupSource.FullName (Join-Path $releaseDir "Claude Dynamic Island Setup.exe")
}

$launcherPath = Join-Path $releaseDir "Launch Claude Dynamic Island.bat"
@"
@echo off
start "" "%~dp0Claude Dynamic Island.exe"
"@ | Set-Content -Encoding ASCII $launcherPath

& "$repoRoot\scripts\refresh-shell-icons.ps1" -Paths @(
  (Join-Path $releaseDir "Claude Dynamic Island.exe"),
  (Join-Path $releaseDir "Claude Dynamic Island Setup.exe")
)

Write-Host ""
Write-Host "Ready-to-run files created in:"
Write-Host "  $releaseDir"
Write-Host ""
Write-Host 'Double-click "Launch Claude Dynamic Island.bat" or "Claude Dynamic Island.exe".'
