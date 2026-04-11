param(
  [string[]]$Paths = @()
)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ShellNotify {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern void SHChangeNotify(uint wEventId, uint uFlags, string dwItem1, IntPtr dwItem2);

  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@

$SHCNE_UPDATEITEM = 0x00002000
$SHCNE_ASSOCCHANGED = 0x08000000
$SHCNF_PATHW = 0x0005
$SHCNF_IDLIST = 0x0000

foreach ($path in $Paths) {
  if (Test-Path $path) {
    [ShellNotify]::SHChangeNotify($SHCNE_UPDATEITEM, $SHCNF_PATHW, (Resolve-Path $path).Path, [IntPtr]::Zero)
  }
}

[ShellNotify]::SHChangeNotify($SHCNE_ASSOCCHANGED, $SHCNF_IDLIST, [IntPtr]::Zero, [IntPtr]::Zero)

$ie4uinit = Get-Command ie4uinit.exe -ErrorAction SilentlyContinue
if ($ie4uinit) {
  & $ie4uinit.Source -show | Out-Null
}
