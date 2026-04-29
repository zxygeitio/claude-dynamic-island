$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$targets = @(
  "dist",
  "release",
  "node_modules",
  "src-tauri\target",
  "src-tauri\gen",
  "src-tauri\.claude",
  ".claude",
  "claude-dynamic-island.exe",
  "Claude Dynamic Island_0.1.0_x64_en-US.msi",
  "preview.out.log",
  "preview.err.log",
  "artifacts-exe-icon.png",
  "artifacts-island.png",
  "artifacts-live-launch.png",
  "artifacts-release-check.png",
  "artifacts-yellow-check.png"
)

function Get-DirectorySizeBytes {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return 0
  }

  $item = Get-Item -LiteralPath $Path -Force
  if (-not $item.PSIsContainer) {
    return $item.Length
  }

  $sum = (Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum

  if ($null -eq $sum) {
    return 0
  }

  return [int64]$sum
}

$repoFullPath = [System.IO.Path]::GetFullPath($repoRoot)
$removedBytes = [int64]0

foreach ($relativePath in $targets) {
  $targetPath = Join-Path $repoRoot $relativePath

  if (-not (Test-Path -LiteralPath $targetPath)) {
    continue
  }

  $targetFullPath = [System.IO.Path]::GetFullPath($targetPath)
  if (-not $targetFullPath.StartsWith($repoFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove path outside repository: $targetFullPath"
  }

  $removedBytes += Get-DirectorySizeBytes -Path $targetFullPath
  Remove-Item -LiteralPath $targetFullPath -Recurse -Force
  Write-Host "Removed $relativePath"
}

$removedGb = [Math]::Round($removedBytes / 1GB, 2)
Write-Host ""
Write-Host "Removed approximately $removedGb GB of generated files."
Write-Host "Run npm install before the next frontend build if node_modules was removed."
