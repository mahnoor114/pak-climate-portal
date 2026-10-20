<#
Opens the Pakistan Climate portal in the browser, starting it first when needed (double-click "Start portal.bat",
or the "Pakistan Climate Portal" icon on the desktop). Shows what it is doing:
  - running and answering  -> opens the browser straight away
  - running but not answering (e.g. the PC is short of memory) -> waits up to a minute, then restarts it
  - not running            -> starts it in the background (it keeps running after this window closes) and
                              opens the browser as soon as it answers
  powershell -ExecutionPolicy Bypass -File start_portal.ps1
#>
$Port   = if ($env:PORTAL_PORT) { [int]$env:PORTAL_PORT } else { 8000 }
$Page   = "http://localhost:$Port/"
$Health = "http://127.0.0.1:$Port/api/ai-status"
$Logs   = Join-Path $env:LOCALAPPDATA 'PakClimatePortal\logs'

function Test-Up([int]$Timeout = 10) {
    try { (Invoke-WebRequest -UseBasicParsing $Health -TimeoutSec $Timeout).StatusCode -eq 200 } catch { $false }
}
function Open-Portal {
    Write-Host ''
    Write-Host "  Portal is ready: $Page" -ForegroundColor Green
    Start-Process $Page
    exit 0
}
function Wait-Up([int]$Seconds, [string]$Message) {
    Write-Host "  $Message" -NoNewline
    $end = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $end) {
        if (Test-Up 5) { Write-Host ''; return $true }
        Write-Host '.' -NoNewline
        Start-Sleep 3
    }
    Write-Host ''
    return $false
}

Write-Host ''
Write-Host '  Pakistan Climate Intelligence' -ForegroundColor Cyan
Write-Host '  -----------------------------'
if (Test-Up) { Open-Portal }

# Running but not answering: give it a minute (a busy or low-memory PC), then restart it
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    if (Wait-Up 60 'The portal is running but busy; waiting for it') { Open-Portal }
    Write-Host '  It is not responding; restarting it.' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'stop_portal.ps1') | Out-Null
}

# Start the watchdog (installed launcher if autostart is set up, else this folder's run_portal.ps1); it runs hidden
# and keeps the portal running after this window closes
$launcher = Join-Path $env:LOCALAPPDATA 'PakClimatePortal\launcher.ps1'
$entry = if (Test-Path $launcher) { $launcher } else { Join-Path $PSScriptRoot 'run_portal.ps1' }
Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$entry`""
if (Wait-Up 240 'Starting the portal (1-2 minutes)') { Open-Portal }

Write-Host ''
Write-Host '  The portal did not start within 4 minutes.' -ForegroundColor Red
Write-Host "  Details: $Logs\watchdog.log"
exit 1
