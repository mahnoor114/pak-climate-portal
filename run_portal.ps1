<#
Runs the Pakistan Climate portal and keeps it running.

  - Copies the portal from this folder (the master copy, on the network drive) to a local working copy in
    %LOCALAPPDATA%\PakClimatePortal\app and runs it from there, so a slow or stalled network drive can't
    freeze startup or page loads. Changes made here are copied over every 10 minutes; if portal_server.py
    itself changed, the server restarts. If the network drive is down, the last local copy keeps running.
  - Starts portal_server.py (which itself refreshes wind every 6 h and climate data daily).
  - Checks every minute that the portal answers; restarts it if it crashed or stopped responding.
  - Writes logs to %LOCALAPPDATA%\PakClimatePortal\logs (server output per start, plus watchdog.log);
    deletes logs older than 14 days.
  - Exits straight away if the portal is already running, so it is safe to start twice.

Normally started hidden at Windows login by install_autostart.ps1. To run it by hand:
  powershell -ExecutionPolicy Bypass -File run_portal.ps1 [-OpenBrowser]
#>
param([switch]$OpenBrowser)

$Source  = $PSScriptRoot                                        # master copy (network drive)
$Base    = Join-Path $env:LOCALAPPDATA 'PakClimatePortal'
$App     = Join-Path $Base 'app'                                # local working copy the server runs from
$LogDir  = Join-Path $Base 'logs'                               # local: a stalled network drive must not block logging
$Port    = if ($env:PORTAL_PORT) { [int]$env:PORTAL_PORT } else { 8000 }
$Health  = "http://127.0.0.1:$Port/api/ai-status"
$PageUrl = "http://localhost:$Port/Pak%20Climate.html"
New-Item -ItemType Directory -Force -Path $App, $LogDir | Out-Null
$WatchLog = Join-Path $LogDir 'watchdog.log'

function Write-Log([string]$Message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message" | Add-Content -Path $WatchLog -Encoding utf8
}

function Test-Portal {
    try { (Invoke-WebRequest -UseBasicParsing $Health -TimeoutSec 15).StatusCode -eq 200 } catch { $false }
}

function Remove-OldLogs {
    Get-ChildItem $LogDir -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force -ErrorAction SilentlyContinue
    if ((Test-Path $WatchLog) -and (Get-Item $WatchLog).Length -gt 5MB) { Move-Item $WatchLog "$WatchLog.old" -Force }
}

# Copy files that are newer in the master copy. /XO never overwrites a newer local file, so data the server
# refreshed locally (lib\indices.js) is kept. Runs with a time limit so a stalled drive can't hang the watchdog.
# Returns $true if portal_server.py changed.
function Sync-App {
    $serverFile = Join-Path $App 'portal_server.py'
    $before = if (Test-Path $serverFile) { (Get-Item $serverFile).LastWriteTimeUtc } else { $null }
    $rc = Start-Process -FilePath robocopy.exe -WindowStyle Hidden -PassThru -ArgumentList @(
        "`"$Source`"", "`"$App`"", '/E', '/XO', '/R:1', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
        '/XD', 'logs', 'backups', '.git', '__pycache__',
        '/XF', '"groc api.txt"', '*.tmp', '*.zip', 'Pakistan_Districts.geojson')
    if (-not $rc.WaitForExit(180000)) {
        Stop-Process -Id $rc.Id -Force -ErrorAction SilentlyContinue
        Write-Log 'Copy from the network drive timed out; running the last local copy.'
        return $false
    }
    if ($rc.ExitCode -ge 8) { Write-Log "Copy from the network drive failed (robocopy code $($rc.ExitCode)); running the last local copy." }
    $after = if (Test-Path $serverFile) { (Get-Item $serverFile).LastWriteTimeUtc } else { $null }
    return ($before -and $after -and $after -ne $before)
}

# "python" on PATH, else the Windows "py" launcher.
$Python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $Python) { $Python = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $Python) { Write-Log 'ERROR: Python not found on PATH; cannot start the portal.'; exit 1 }

if (Test-Portal) {
    Write-Log "Portal already running on port $Port; this copy exits."
    if ($OpenBrowser) { Start-Process $PageUrl }
    exit 0
}

# API keys are user environment variables (setx). A process started at login already has them, but read
# them explicitly so a key added after login is picked up on the next restart.
foreach ($name in 'XAI_API_KEY', 'ANTHROPIC_API_KEY', 'PORTAL_PORT', 'PORTAL_DB_PASSWORD', 'PORTAL_DB_NAME') {
    $v = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($v) { Set-Item -Path "Env:$name" -Value $v }
}

Write-Log "Watchdog started (python: $Python, port $Port, master copy: $Source, running from: $App)."
Sync-App | Out-Null
if (-not (Test-Path (Join-Path $App 'portal_server.py'))) { Write-Log 'ERROR: no local copy of the portal yet and the network drive is unreachable.'; exit 1 }

$server = $null
$failedChecks = 0
$openedBrowser = -not $OpenBrowser
$lastSync = Get-Date

while ($true) {
    if (-not $server -or $server.HasExited) {
        if ($server) { Write-Log "Server stopped (exit code $($server.ExitCode)); restarting in 10 s."; Start-Sleep 10 }
        Remove-OldLogs
        $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
        $server = Start-Process -FilePath $Python -ArgumentList '-u', 'portal_server.py' -WorkingDirectory $App `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $LogDir "server_$stamp.log") `
            -RedirectStandardError  (Join-Path $LogDir "server_$stamp.err.log")
        Write-Log "Server started (PID $($server.Id))."
        $failedChecks = 0
        Start-Sleep 20
    }

    if (Test-Portal) {
        $failedChecks = 0
        if (-not $openedBrowser) { Start-Process $PageUrl; $openedBrowser = $true }
    } elseif (-not $server.HasExited) {
        $failedChecks++
        Write-Log "Health check failed ($failedChecks/3)."
        if ($failedChecks -ge 3) {
            Write-Log 'Server not responding; stopping it so it restarts.'
            Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
            $server.WaitForExit(10000) | Out-Null
        }
    }

    if (((Get-Date) - $lastSync).TotalMinutes -ge 10) {
        $lastSync = Get-Date
        if (Sync-App) {
            Write-Log 'portal_server.py changed in the master copy; restarting the server to use it.'
            Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
            $server.WaitForExit(10000) | Out-Null
        }
    }
    Start-Sleep 60
}
