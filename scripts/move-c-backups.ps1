$ErrorActionPreference = "Stop"

$archive = "D:\DevEnv\migrated-backups"
New-Item -ItemType Directory -Force -Path $archive | Out-Null

$items = @(
  "C:\Users\zxy\.cache.c_backup",
  "C:\Users\zxy\.gemini.c_backup",
  "C:\Users\zxy\.local.c_backup",
  "C:\Users\zxy\.m2.c_backup",
  "C:\Users\zxy\go.c_backup",
  "C:\Users\zxy\AppData\Local\ms-playwright.c_backup",
  "C:\Users\zxy\AppData\Local\npm-cache.c_backup",
  "C:\Users\zxy\AppData\Local\uv.c_backup"
)

foreach ($item in $items) {
  if (-not (Test-Path -LiteralPath $item)) {
    continue
  }

  $dest = Join-Path $archive ([IO.Path]::GetFileName($item))
  if (Test-Path -LiteralPath $dest) {
    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  }

  Move-Item -LiteralPath $item -Destination $dest -Force
}

Write-Output "Backup move complete."
