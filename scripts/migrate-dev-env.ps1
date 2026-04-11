$ErrorActionPreference = "Stop"

$items = @(
  @{ Src = "C:\Users\zxy\.cache"; Dst = "D:\DevEnv\home\.cache" },
  @{ Src = "C:\Users\zxy\.local"; Dst = "D:\DevEnv\home\.local" },
  @{ Src = "C:\Users\zxy\go"; Dst = "D:\DevEnv\go" },
  @{ Src = "C:\Users\zxy\.m2"; Dst = "D:\DevEnv\.m2" },
  @{ Src = "C:\Users\zxy\.gemini"; Dst = "D:\DevEnv\.gemini" },
  @{ Src = "C:\Users\zxy\AppData\Local\uv"; Dst = "D:\DevEnv\uv" },
  @{ Src = "C:\Users\zxy\AppData\Local\ms-playwright"; Dst = "D:\DevEnv\ms-playwright" },
  @{ Src = "C:\Users\zxy\AppData\Local\go-build"; Dst = "D:\DevEnv\go-build" }
)

foreach ($item in $items) {
  if (-not (Test-Path -LiteralPath $item.Src)) {
    continue
  }

  $srcItem = Get-Item -LiteralPath $item.Src -Force
  if ($srcItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    continue
  }

  $dstParent = Split-Path -Parent $item.Dst
  New-Item -ItemType Directory -Force -Path $dstParent | Out-Null
  if (-not (Test-Path -LiteralPath $item.Dst)) {
    New-Item -ItemType Directory -Force -Path $item.Dst | Out-Null
  }

  robocopy $item.Src $item.Dst /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null

  $backup = "$($item.Src).c_backup"
  if (Test-Path -LiteralPath $backup) {
    Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
  }

  Rename-Item -LiteralPath $item.Src -NewName ([IO.Path]::GetFileName($backup))
  cmd /c "mklink /J `"$($item.Src)`" `"$($item.Dst)`"" | Out-Null
}

setx GOPATH "D:\DevEnv\go" | Out-Null
setx GOMODCACHE "D:\DevEnv\go\pkg\mod" | Out-Null
setx GOCACHE "D:\DevEnv\go-build" | Out-Null
setx UV_CACHE_DIR "D:\DevEnv\uv" | Out-Null
setx PLAYWRIGHT_BROWSERS_PATH "D:\DevEnv\ms-playwright" | Out-Null

Write-Output "Migration batch complete."
