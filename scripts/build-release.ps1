$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Assert-PathExists {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [string] $Description
  )

  if (-not (Test-Path $Path)) {
    throw "Missing $Description at: $Path"
  }
}

function Assert-ExeFileValid {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,

    [Parameter(Mandatory = $true)]
    [string] $Description
  )

  Assert-PathExists $Path $Description

  $item = Get-Item $Path
  if ($item.Length -le 0) {
    throw "$Description is empty: $Path"
  }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $header = [byte[]]::new(2)
    $read = $stream.Read($header, 0, 2)
    if ($read -ne 2 -or $header[0] -ne 0x4D -or $header[1] -ne 0x5A) {
      throw "$Description is not a Windows PE executable: $Path"
    }
  } finally {
    $stream.Dispose()
  }
}

python "$repoRoot\scripts\generate-icons.py"

npm run tauri build -- --bundles nsis

$releaseDir = Join-Path $repoRoot "release"
if (Test-Path $releaseDir) {
  Remove-Item $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

$exeSource = Join-Path $repoRoot "src-tauri\target\release\claude-dynamic-island.exe"
$resourcesSource = Join-Path $repoRoot "src-tauri\target\release\_up_"
$nsisDir = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"

Assert-ExeFileValid $exeSource "Tauri release executable"
Assert-PathExists $resourcesSource "Tauri bundled resources directory"
Assert-PathExists $nsisDir "NSIS bundle directory"

$setupSource = Get-ChildItem (Join-Path $nsisDir "*setup.exe") |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $setupSource) {
  throw "Missing NSIS setup executable in: $nsisDir"
}

Copy-Item $exeSource (Join-Path $releaseDir "Claude Dynamic Island.exe")
Copy-Item $resourcesSource (Join-Path $releaseDir "_up_") -Recurse
Copy-Item $setupSource.FullName (Join-Path $releaseDir "Claude Dynamic Island Setup.exe")

$launcherPath = Join-Path $releaseDir "Launch Claude Dynamic Island.bat"
@"
@echo off
start "" "%~dp0Claude Dynamic Island.exe"
"@ | Set-Content -Encoding ASCII $launcherPath

& "$repoRoot\scripts\refresh-shell-icons.ps1" -Paths @(
  (Join-Path $releaseDir "Claude Dynamic Island.exe"),
  (Join-Path $releaseDir "Claude Dynamic Island Setup.exe")
)

$releaseExe = Join-Path $releaseDir "Claude Dynamic Island.exe"
$releaseSetup = Join-Path $releaseDir "Claude Dynamic Island Setup.exe"
$releaseResources = Join-Path $releaseDir "_up_"

Assert-PathExists $releaseExe "portable release executable"
Assert-PathExists $releaseSetup "release installer executable"
Assert-PathExists $releaseResources "portable release resources directory"
Assert-PathExists $launcherPath "release launcher"
Assert-ExeFileValid $releaseExe "portable release executable"
Assert-ExeFileValid $releaseSetup "release installer executable"

Write-Host ""
Write-Host "Ready-to-run files created in:"
Write-Host "  $releaseDir"
Write-Host ""
Write-Host "Verified release artifacts:"
Write-Host "  $releaseExe"
Write-Host "  $releaseSetup"
Write-Host "  $releaseResources"
Write-Host ""
Write-Host 'Double-click "Launch Claude Dynamic Island.bat" or "Claude Dynamic Island.exe".'
