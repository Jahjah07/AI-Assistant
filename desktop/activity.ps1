$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class JimmyForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr handle, StringBuilder title, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] public static extern uint GetLastInputInfo(ref LastInput info);
  [StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint size; public uint tick; }
}
'@
while ($true) {
  try {
    $handle = [JimmyForeground]::GetForegroundWindow()
    $foregroundId = [uint32]0
    [void][JimmyForeground]::GetWindowThreadProcessId($handle, [ref]$foregroundId)
    $title = [System.Text.StringBuilder]::new(1024)
    [void][JimmyForeground]::GetWindowText($handle, $title, $title.Capacity)
    $activeProcess = Get-Process -Id $foregroundId -ErrorAction Stop
    $idleInfo = [JimmyForeground+LastInput]::new()
    $idleInfo.size = [System.Runtime.InteropServices.Marshal]::SizeOf($idleInfo)
    [void][JimmyForeground]::GetLastInputInfo([ref]$idleInfo)
    $idleMs = ([long][Environment]::TickCount - [long]$idleInfo.tick) -band 0xffffffffL
    if ($idleMs -lt 300000) {
      @{ app = $activeProcess.ProcessName; title = $title.ToString() } | ConvertTo-Json -Compress
    }
  } catch { }
  Start-Sleep -Seconds 10
}
