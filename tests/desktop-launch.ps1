$ErrorActionPreference = 'Stop'
$launcher = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\desktop.ps1'
$calls = @{ registered = $null; started = $null; state = 'Ready'; failRegistration = $false }
function Assert($condition, $message) { if (!$condition) { throw $message } }
function Get-ScheduledTask { param($TaskName, $ErrorAction) [pscustomobject]@{ State = $calls.state } }
function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) $PSBoundParameters }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) $PSBoundParameters }
function New-ScheduledTaskSettingsSet {
    param([switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries, $ExecutionTimeLimit, $MultipleInstances, [switch]$StartWhenAvailable, $RestartCount, $RestartInterval)
    $PSBoundParameters
}
function Register-ScheduledTask {
    param($TaskName, $Action, $Principal, $Settings, $Description, $Trigger, [switch]$Force)
    if ($calls.failRegistration) { throw 'Registration denied' }
    $calls.registered = $PSBoundParameters
}
function Start-ScheduledTask { param($TaskName) $calls.started = $TaskName }
function Start-Process { throw 'Jimmy must not inherit the terminal process tree' }
function New-ScheduledTaskTrigger { param([switch]$AtLogOn, $User) [pscustomobject]@{ AtLogOn = $AtLogOn; User = $User; Delay = '' } }
function Unregister-ScheduledTask { param($TaskName, $Confirm, $ErrorAction) }

$output = & $launcher start
Assert ($calls.started -eq 'Jimmy Manual Launch') 'Manual launch must start the independent task'
Assert ($calls.registered.TaskName -eq 'Jimmy Manual Launch') 'Manual launch must not replace login startup'
Assert (!$calls.registered.ContainsKey('Trigger')) 'Manual launch must not enable automatic startup'
Assert ($calls.registered.Principal.LogonType -eq 'Interactive') 'Jimmy must appear on the signed-in desktop'
Assert ($calls.registered.Principal.RunLevel -eq 'Limited') 'Jimmy must not request elevated privileges'
Assert ($calls.registered.Settings.ExecutionTimeLimit -eq [TimeSpan]::Zero) 'Jimmy must not time out'
Assert ($calls.registered.Settings.MultipleInstances -eq 'IgnoreNew') 'Repeated launch must not queue sessions'
Assert ($calls.registered.Settings.AllowStartIfOnBatteries -and $calls.registered.Settings.DontStopIfGoingOnBatteries) 'Jimmy must remain available on battery'
Assert ($calls.registered.Action.Execute -like '*\electron.exe') 'Task must run Electron directly'
Assert ($calls.registered.Action.Argument -eq ('"' + (Join-Path (Split-Path $PSScriptRoot -Parent) 'desktop\main.mjs') + '"')) 'Entry path must be quoted, including spaces'
Assert ($calls.registered.Action.WorkingDirectory -eq (Split-Path $PSScriptRoot -Parent)) 'Task must use the project directory'
Assert ($output -like '*launch requested*') 'Output must describe a launch request, not claim a visible window'

$calls.registered = $null
$calls.state = 'Running'
& $launcher start | Out-Null
Assert ($null -eq $calls.registered) 'Repeated launch must not replace a running task'

$calls.state = 'Ready'
$calls.failRegistration = $true
$calls.started = $null
try { & $launcher start | Out-Null; throw 'Expected registration failure' }
catch { Assert ($_.Exception.Message -eq 'Registration denied') 'Registration errors must reach the terminal' }
Assert ($null -eq $calls.started) 'A failed registration must not launch a stale task'

$calls.failRegistration = $false
& $launcher enable-startup | Out-Null
Assert ($calls.registered.TaskName -eq 'Jimmy Floating Assistant') 'Login startup must retain its separate task'
Assert ($calls.registered.Trigger.AtLogOn -and $calls.registered.Trigger.Delay -eq 'PT20S') 'Login startup must keep its delayed sign-in trigger'
Write-Output 'Desktop launcher checks passed.'

