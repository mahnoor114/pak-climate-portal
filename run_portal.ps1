<#
Runs the Pakistan Climate portal and keeps it running.

  - Starts portal_server.py (which itself refreshes wind every 6 h and climate data daily).
  - Checks every minute that the portal answers; restarts it if it crashed or stopped responding.
  - Writes logs to .\logs (server output per start, plus watchdog.log); deletes logs older than 14 days.
  - Exits straight away if the portal is already running, so it is safe to start twice.

Normally started hidden at Windows login by install_autostart.ps1. To run it by hand:
  powershell -ExecutionPolicy Bypass -File run_portal.ps1 [-OpenBrowser]
#>
param([switch]$OpenBrowser)

$Root    = $PSScriptRoot
$Port    = if ($env:PORTAL_PORT) { [int]$env:PORTAL_PORT } else { 8000 }
$Health  = "http://127.0.0.1:$Port/api/ai-status"
$PageUrl = "http://localhost:$Port/Pak%20Climate.html"
$LogDir  = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
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
foreach ($name in 'XAI_API_KEY', 'ANTHROPIC_API_KEY', 'PORTAL_PORT') {
    $v = [Environment]::GetEnvironmentVariable($name, 'User')
    if ($v) { Set-Item -Path "Env:$name" -Value $v }
}

Write-Log "Watchdog started (python: $Python, port $Port)."
$server = $null
$failedChecks = 0
$openedBrowser = -not $OpenBrowser

while ($true) {
    if (-not $server -or $server.HasExited) {
        if ($server) { Write-Log "Server stopped (exit code $($server.ExitCode)); restarting in 10 s."; Start-Sleep 10 }
        Remove-OldLogs
        $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
        $server = Start-Process -FilePath $Python -ArgumentList '-u', 'portal_server.py' -WorkingDirectory $Root `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $LogDir "server_$stamp.log") `
            -RedirectStandardError  (Join-Path $LogDir "server_$stamp.err.log")
        Write-Log "Server started (PID $($server.Id))."
        $failedChecks = 0
        Start-Sleep 45   # starting from the network drive takes ~30 s (library imports)
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
    Start-Sleep 60
}
