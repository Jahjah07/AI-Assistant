param([ValidateSet('start', 'enable-startup', 'disable-startup', 'startup-status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$electron = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$main = Join-Path $projectRoot 'desktop\main.mjs'
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'Jimmy Floating Assistant'
$legacyTaskName = 'Johnny Floating Assistant'
if ($Action -eq 'startup-status') {
    Get-ScheduledTask -TaskName $taskName, $legacyTaskName -ErrorAction SilentlyContinue | Select-Object TaskName, State
    exit 0
}
if ($Action -eq 'disable-startup') {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output 'Jimmy login startup removed. You can still launch npm run desktop:start.'
    exit 0
}
if (!(Test-Path -LiteralPath $electron)) { throw 'Install dependencies with npm install first.' }
if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.next\BUILD_ID'))) { throw 'Run npm run build first.' }
if ($Action -eq 'enable-startup') {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
    $trigger.Delay = 'PT20S'
    $taskAction = New-ScheduledTaskAction -Execute $electron -Argument "`"$main`"" -WorkingDirectory $projectRoot
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start Jimmy floating assistant at login. Microphone listens for Jimmy; tray menu can mute or shut down and unload models.' -Force | Out-Null
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output 'Jimmy will start 20 seconds after your Windows sign-in. No terminal window is opened.'
} else {
    # The scheduler owns Electron so closing VS Code cannot kill its process tree.
    $manualTaskName = 'Jimmy Manual Launch'
    $existing = Get-ScheduledTask -TaskName $manualTaskName -ErrorAction SilentlyContinue
    if (!$existing -or $existing.State -ne 'Running') {
        $taskAction = New-ScheduledTaskAction -Execute $electron -Argument "`"$main`"" -WorkingDirectory $projectRoot
        $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $manualTaskName -Action $taskAction -Principal $principal -Settings $settings -Description 'Launch Jimmy on demand, independently of the terminal. No automatic startup trigger.' -Force | Out-Null
    }
    Start-ScheduledTask -TaskName $manualTaskName
    Write-Output 'Jimmy launch requested independently of this terminal. Look for the floating circle or tray icon; use Jimmy shutdown to exit.'
}
