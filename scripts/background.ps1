param([ValidateSet('start', 'stop', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeDir = Join-Path $projectRoot '.jimmy-runtime'
if (Test-Path -LiteralPath (Join-Path $projectRoot '.johnny-runtime/server.json')) { $runtimeDir = Join-Path $projectRoot '.johnny-runtime' }
$statePath = Join-Path $runtimeDir 'server.json'
$nextPath = Join-Path $projectRoot 'node_modules\next\dist\bin\next'

function Get-JimmyProcess {
    if (!(Test-Path -LiteralPath $statePath)) { return $null }
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.processId)"
    if ($candidate -and $candidate.CommandLine -and $candidate.CommandLine.Contains($nextPath) -and
        $candidate.CreationDate.ToUniversalTime().ToString('o') -eq $state.created) { return $candidate }
    return $null
}
$server = Get-JimmyProcess
if ($Action -eq 'status') {
    if ($server) { Write-Output "Jimmy is running in the background (PID $($server.ProcessId)): http://localhost:3001" }
    else { Write-Output 'Jimmy background server is stopped.' }
    exit 0
}
if ($Action -eq 'stop') {
    if ($server) {
        Stop-Process -Id $server.ProcessId
        Write-Output 'Jimmy background server stopped. Voice containers and Ollama remain available.'
    } else { Write-Output 'Jimmy background server is already stopped.' }
    exit 0
}
if ($server) { Write-Output 'Jimmy is already running: http://localhost:3001'; exit 0 }
if (!(Test-Path -LiteralPath (Join-Path $projectRoot '.next\BUILD_ID'))) {
    throw 'Build Jimmy first with npm run build, then run npm run background:start.'
}
$listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw 'Port 3001 is already in use. Stop the existing dev/server terminal before starting background mode.' }
# Verify process inspection is available before launching a detached process.
$null = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$nodePath = (Get-Command node -CommandType Application).Source
$process = Start-Process -WindowStyle Hidden -FilePath $nodePath -ArgumentList @("`"$nextPath`"", 'start', '--hostname', '127.0.0.1', '--port', '3001') -WorkingDirectory $projectRoot -RedirectStandardOutput (Join-Path $runtimeDir 'server.log') -RedirectStandardError (Join-Path $runtimeDir 'server-error.log') -PassThru
$identity = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
if (!$identity) { throw "Jimmy exited during startup. Check .jimmy-runtime/server-error.log." }
@{processId=$process.Id; created=$identity.CreationDate.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $statePath
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    $process.Refresh()
    if ($process.HasExited) { throw 'Jimmy failed to start. Check .jimmy-runtime/server-error.log.' }
    $ready = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $process.Id
    if ($ready) { Write-Output 'Jimmy is running in the background: http://localhost:3001'; exit 0 }
    Start-Sleep -Milliseconds 500
}
throw 'Jimmy is still starting. Check npm run background:status and .jimmy-runtime/server-error.log.'

